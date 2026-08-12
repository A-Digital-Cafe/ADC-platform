import type { Model } from "mongoose";
import { RegionInfo, RegionMetadata } from "@common/types/identity/Region.ts";
import type { ILogger } from "../../../../interfaces/utils/ILogger.js";
import { type AuthVerifierGetter, PermissionChecker } from "@common/types/auth-verifier.ts";
import { IdentityScopes, RESOURCE_NAME } from "@common/types/identity/permissions.ts";
import { CRUDXAction } from "@common/types/Actions.ts";
import { buildUpdateSet } from "@common/utils/mongo-update.ts";
import { REGION_UPDATABLE_FIELDS } from "../domain/region.js";

export class RegionManager {
	readonly #regionsCache: Map<string, RegionInfo> = new Map();
	#globalRegion: RegionInfo | null = null;
	readonly #permissionChecker: PermissionChecker;

	constructor(
		private readonly regionModel: Model<any>,
		private readonly orgModel: Model<any>,
		private readonly logger: ILogger,
		/** URI de conexión para la región global default (declarada en config.json). */
		private readonly defaultObjectUri: string,
		getAuthVerifier: AuthVerifierGetter = () => null,
		/**
		 * Aviso de que una región mutó en ESTE nodo. Opcional: sin él la cache local queda
		 * correcta igual, pero como no tiene TTL, los demás nodos se quedan con la región vieja
		 * (URI de conexión incluida) hasta el próximo arranque.
		 */
		private readonly onRegionChanged?: (path: string) => void
	) {
		this.#permissionChecker = new PermissionChecker(getAuthVerifier, "RegionManager", RESOURCE_NAME);
	}

	/**
	 * Precarga todas las regiones en memoria
	 * Debe llamarse al inicio del servicio
	 */
	async initialize(): Promise<void> {
		await this.#ensureDefaultRegion();
		await this.#purgeLegacyCacheUri();
		await this.reload();
	}

	/**
	 * `metadata.cacheConnectionUri` se editaba desde el panel y no lo consumía nadie. Sacarlo del
	 * schema impide escribirlo de nuevo, pero no limpia lo ya guardado: mongoose devuelve las
	 * claves que no declara, así que un valor viejo seguiría saliendo por `GET /regions`. Y lo que
	 * quedaría ahí es una credencial de Redis que nadie va a rotar porque nada la usa.
	 *
	 * `strict: false` es obligatorio, no una precaución: con el strict por defecto mongoose descarta
	 * del update las rutas que el schema ya no declara — incluidas las de `$unset` — y la limpieza
	 * queda en un no-op silencioso (`modifiedCount` ni siquiera vuelve).
	 *
	 * Idempotente y de una sola pasada; se puede borrar cuando toda la flota haya arrancado una vez.
	 */
	async #purgeLegacyCacheUri(): Promise<void> {
		const result = await this.regionModel.updateMany(
			{ "metadata.cacheConnectionUri": { $exists: true } },
			{ $unset: { "metadata.cacheConnectionUri": "" } },
			{ strict: false }
		);

		if (result.modifiedCount > 0) {
			this.logger.logOk(`[RegionManager] cacheConnectionUri removido de ${result.modifiedCount} región(es): el campo ya no existe`);
		}
	}

	/**
	 * Relee las regiones desde Mongo. Repetible a propósito (a diferencia de `initialize()`, no
	 * crea nada): es lo que corre cuando otro nodo avisa que una región cambió.
	 *
	 * Resetea `#globalRegion` antes de repoblar: si la que era global dejó de serlo, conservarla
	 * mandaría las escrituras a la base equivocada.
	 */
	async reload(): Promise<void> {
		const regions = await this.regionModel.find({ isActive: true });
		this.#regionsCache.clear();
		this.#globalRegion = null;

		for (const region of regions) {
			const info = this.#toRegionInfo(region);
			this.#regionsCache.set(region.path, info);

			if (info.isGlobal) {
				this.#globalRegion = info;
			}
		}

		this.logger.logOk(`[RegionManager] ${this.#regionsCache.size} regiones cargadas en cache`);
	}

	/**
	 * Asegura que existe la región default/default como global
	 */
	async #ensureDefaultRegion(): Promise<void> {
		const defaultPath = "default/default";
		const existing = await this.regionModel.findOne({ path: defaultPath });

		if (!existing) {
			await this.regionModel.create({
				path: defaultPath,
				isGlobal: true,
				isActive: true,
				metadata: {
					objectConnectionUri: this.defaultObjectUri,
				},
			});

			this.logger.logOk(`[RegionManager] Región global creada: ${defaultPath}`);
		}
	}

	/**
	 * Crea una nueva región
	 */
	async createRegion(path: string, metadata: RegionMetadata, isGlobal: boolean = false, token?: string): Promise<RegionInfo> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.WRITE, IdentityScopes.REGIONS);

		if (!this.#validatePath(path)) {
			throw new Error(`Formato de path inválido: ${path}. Esperado "region/subregion"`);
		}

		// Solo puede haber una región global
		if (isGlobal && this.#globalRegion) {
			throw new Error(`Ya existe una región global: ${this.#globalRegion.path}`);
		}

		const region = await this.regionModel.create({
			path,
			isGlobal,
			isActive: true,
			metadata,
		});

		const info = this.#toRegionInfo(region);
		this.#regionsCache.set(path, info);

		if (isGlobal) {
			this.#globalRegion = info;
		}

		this.logger.logOk(`[RegionManager] Región creada: ${path}${isGlobal ? " (global)" : ""}`);
		this.onRegionChanged?.(path);
		return info;
	}

	/**
	 * Obtiene una región por path
	 */
	async getRegion(path: string, token?: string): Promise<RegionInfo | null> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.READ, IdentityScopes.REGIONS);

		// Primero revisar cache
		if (this.#regionsCache.has(path)) {
			return this.#regionsCache.get(path)!;
		}

		// Fallback a base de datos
		const region = await this.regionModel.findOne({ path });
		if (region) {
			const info = this.#toRegionInfo(region);
			this.#regionsCache.set(path, info);
			return info;
		}

		return null;
	}

	/**
	 * Obtiene la región global (para escrituras)
	 */
	async getGlobalRegion(token?: string): Promise<RegionInfo> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.READ, IdentityScopes.REGIONS);

		if (this.#globalRegion) {
			return this.#globalRegion;
		}

		const region = await this.regionModel.findOne({ isGlobal: true });
		if (!region) {
			throw new Error("No existe una región global configurada");
		}

		this.#globalRegion = this.#toRegionInfo(region);
		return this.#globalRegion;
	}

	/**
	 * Actualiza una región
	 */
	async updateRegion(path: string, updates: Partial<RegionInfo>, token?: string): Promise<RegionInfo> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.UPDATE, IdentityScopes.REGIONS);

		// No permitir cambiar isGlobal si ya hay otra región global
		if (updates.isGlobal && this.#globalRegion && this.#globalRegion.path !== path) {
			throw new Error(`Ya existe una región global: ${this.#globalRegion.path}`);
		}

		const update = buildUpdateSet(updates, REGION_UPDATABLE_FIELDS, { updatedAt: new Date() });
		const region = await this.regionModel.findOneAndUpdate({ path }, update, { new: true });

		if (!region) throw new Error(`Región no encontrada: ${path}`);

		const info = this.#toRegionInfo(region);
		this.#regionsCache.set(path, info);

		if (info.isGlobal) {
			this.#globalRegion = info;
		} else if (this.#globalRegion?.path === path) {
			// Dejó de ser la global: el resto de los nodos lo van a ver al recargar, y este se
			// quedaría mandando las escrituras a la base equivocada.
			this.#globalRegion = null;
		}

		this.onRegionChanged?.(path);
		return info;
	}

	/**
	 * Elimina una región
	 */
	async deleteRegion(path: string, token?: string): Promise<void> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.DELETE, IdentityScopes.REGIONS);

		if (path === "default/default") {
			throw new Error("No se puede eliminar la región default");
		}

		const region = await this.regionModel.findOne({ path });
		if (region?.isGlobal) {
			throw new Error("No se puede eliminar la región global");
		}

		// Validar que no hay organizaciones usando esta región
		const orgsUsingRegion = await this.orgModel.countDocuments({ region: path });
		if (orgsUsingRegion > 0) {
			throw new Error(`No se puede eliminar la región ${path}: ${orgsUsingRegion} organización(es) la están usando`);
		}

		await this.regionModel.deleteOne({ path });
		this.#regionsCache.delete(path);

		this.logger.logDebug(`[RegionManager] Región eliminada: ${path}`);
		this.onRegionChanged?.(path);
	}

	/**
	 * Obtiene todas las regiones activas
	 */
	async getAllRegions(token?: string): Promise<RegionInfo[]> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.READ, IdentityScopes.REGIONS);

		return Array.from(this.#regionsCache.values());
	}

	/**
	 * Obtiene el objectConnectionUri para una región
	 * Si la región no tiene uno propio, hereda del global
	 */
	getObjectConnectionUri(path: string): string | null {
		const region = this.#regionsCache.get(path);

		// Si tiene URI propio, usarlo
		if (region?.metadata?.objectConnectionUri) {
			return region.metadata.objectConnectionUri;
		}

		// Si no, heredar del global
		if (this.#globalRegion?.metadata?.objectConnectionUri) {
			return this.#globalRegion.metadata.objectConnectionUri;
		}

		return null;
	}

	/**
	 * Valida el formato del path: "region/subregion"
	 */
	#validatePath(path: string): boolean {
		const parts = path.split("/");
		return parts.length === 2 && parts.every((p) => p.length > 0 && /^[a-z0-9-]+$/.test(p));
	}

	#toRegionInfo(doc: any): RegionInfo {
		return {
			path: doc.path,
			isGlobal: doc.isGlobal,
			isActive: doc.isActive,
			metadata: doc.metadata || {},
			createdAt: doc.createdAt,
			updatedAt: doc.updatedAt,
		};
	}
}
