import type { Model } from "mongoose";
import type { ILogger } from "../../../../interfaces/utils/ILogger.js";
import { generateId } from "@common/utils/crypto.ts";
import { type AuthVerifierGetter, PermissionChecker } from "@common/types/auth-verifier.ts";
import { IdentityScopes, RESOURCE_NAME } from "@common/types/identity/permissions.ts";
import { CRUDXAction } from "@common/types/Actions.ts";
import type { RegionManager } from "./regions.js";
import type { RoleManager } from "./roles.js";
import type { GroupManager } from "./groups.js";
import type { UserManager } from "./users.js";
import type { Organization } from "@common/types/identity/Organization.ts";
import type OperationsService from "../../../core/OperationsService/index.ts";
import type { Step } from "../../../core/OperationsService/types.ts";
import { AuthorizationError } from "@common/types/custom-errors/AuthorizationError.ts";

function isDuplicateKeyError(error: unknown): error is { code: number } {
	return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}

export class OrgManager {
	readonly #permissionChecker: PermissionChecker;
	readonly #operations: OperationsService;
	readonly #getAuthVerifier: AuthVerifierGetter;

	constructor(
		private readonly orgModel: Model<Organization>,
		private readonly roleManager: RoleManager,
		private readonly groupManager: GroupManager,
		private readonly userManager: UserManager,
		private readonly regionManager: RegionManager,
		private readonly logger: ILogger,
		operations: OperationsService,
		getAuthVerifier: AuthVerifierGetter = () => null
	) {
		this.#permissionChecker = new PermissionChecker(getAuthVerifier, "OrgManager", RESOURCE_NAME);
		this.#operations = operations;
		this.#getAuthVerifier = getAuthVerifier;
	}

	/** Crea una nueva organización */
	async createOrganization(slug: string, region?: string, metadata?: Record<string, any>, token?: string): Promise<Organization> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.WRITE, IdentityScopes.ORGANIZATIONS);

		const regionPath = region || "default/default";

		// Validar que la región existe
		const regionInfo = await this.regionManager.getRegion(regionPath);
		if (!regionInfo) {
			throw new Error(`Región no existe: ${regionPath}`);
		}

		// Validar slug
		const normalizedSlug = slug.toLowerCase().trim();
		if (!/^[a-z0-9-]+$/.test(normalizedSlug)) {
			throw new Error(`Slug inválido: ${slug}. Solo letras minúsculas, números y guiones`);
		}
		if (normalizedSlug === "default") {
			throw new Error(`Slug reservado: 'default' está reservado para contexto global`);
		}

		try {
			const org = await this.orgModel.create({
				orgId: generateId(),
				slug: normalizedSlug,
				region: regionPath,
				tier: "default",
				status: "active",
				approved: true,
				metadata,
			});

			this.logger.logOk(`[OrgManager] Organización creada: ${normalizedSlug} en ${regionPath}`);
			return this.#toOrganization(org);
		} catch (error) {
			if (isDuplicateKeyError(error)) {
				throw new Error(`Organización ${slug} ya existe`, { cause: error });
			}
			throw error;
		}
	}

	/**
	 * Obtiene una organización por ID o slug.
	 *
	 * Reglas de acceso:
	 *  - Usuarios con permiso formal `ORGANIZATIONS.READ` (admins globales, etc.).
	 *  - O cualquier usuario cuyo token pertenezca a esta misma organización
	 *    (necesario para que la app pueda resolver su propio contexto de org).
	 *  - Invocadores internos (manager sin auth verifier, p.ej. SessionManagerService
	 *    durante login/registro) pueden llamar sin token: el `PermissionChecker`
	 *    hace short-circuit al no haber verifier.
	 *
	 * Para llamadas externas (con auth verifier activo) exigimos token ANTES de
	 * tocar la DB, para no exponer la colección a lecturas anónimas desde endpoints.
	 */
	async getOrganization(orgIdOrSlug: string, token?: string): Promise<Organization | null> {
		const isExternalCall = this.#getAuthVerifier() !== null;
		if (isExternalCall && !token) {
			throw new AuthorizationError("Token de autenticación requerido", "NO_TOKEN");
		}

		const org = await this.orgModel
			.findOne({
				$or: [{ orgId: orgIdOrSlug }, { slug: orgIdOrSlug.toLowerCase() }],
			})
			.lean();

		if (!org) return null;

		const resolvedOrgId = org.orgId;
		await this.#permissionChecker.requirePermission(token, CRUDXAction.READ, IdentityScopes.ORGANIZATIONS, {
			allowIf: (_uid, { orgId: tokenOrgId }) => !!tokenOrgId && tokenOrgId === resolvedOrgId,
		});

		return this.#toOrganization(org);
	}

	// Resolución ligera `orgId|slug → { orgId, slug }` para construir URLs públicas.
	async resolveOrganizationSlug(orgIdOrSlug: string, token?: string): Promise<{ orgId: string; slug: string } | null> {
		if (this.#getAuthVerifier() !== null) await this.#permissionChecker.resolveUserId(token);
		const org = await this.orgModel.findOne({ $or: [{ orgId: orgIdOrSlug }, { slug: orgIdOrSlug.toLowerCase() }] }, { orgId: 1, slug: 1 });
		return org ? { orgId: org.orgId, slug: org.slug } : null;
	}

	/** Actualiza una organización */
	async updateOrganization(orgId: string, updates: Partial<Organization>, token?: string): Promise<Organization> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.UPDATE, IdentityScopes.ORGANIZATIONS);

		// No permitir cambiar orgId
		delete (updates as any).orgId;

		// Si se cambia la región, validar que existe
		if (updates.region) {
			const regionInfo = await this.regionManager.getRegion(updates.region);
			if (!regionInfo) throw new Error(`Región no existe: ${updates.region}`);
		}

		const org = await this.orgModel.findOneAndUpdate({ orgId }, { ...updates, updatedAt: new Date() }, { new: true, lean: true });

		if (!org) throw new Error(`Organización no encontrada: ${orgId}`);

		this.logger.logDebug(`[OrgManager] Organización actualizada: ${orgId}`);
		return this.#toOrganization(org);
	}

	/** Elimina una organización y todas sus referencias (cascade a través de DAOs) */
	async deleteOrganization(orgId: string, token?: string, resumeFromStep?: number): Promise<void> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.DELETE, IdentityScopes.ORGANIZATIONS);

		const org = await this.orgModel.findOne({ orgId });
		if (!org) throw new Error(`Organización no encontrada: ${orgId}`);

		// Steps defined here in the DAO - the source of truth for cascade order
		const steps: Step[] = [
			// 0: Eliminar roles de la org (cascade → user.roleIds, orgMemberships.roleIds, group.roleIds)
			() => this.roleManager.deleteAllForOrg(orgId, token),
			// 1: Eliminar groups de la org (cascade → user.groupIds)
			() => this.groupManager.deleteAllForOrg(orgId, token),
			// 2: Limpiar orgMemberships de todos los users
			() => this.userManager.removeAllOrgMemberships(orgId, token),
			// 3: Eliminar el documento de la organización
			() => this.orgModel.deleteOne({ orgId }).then(() => {}),
		];

		const startIdx = resumeFromStep ?? 0;

		const failedStep = await this.#operations.stepper(startIdx, "delete-org", orgId, steps);
		if (failedStep !== null) {
			const err = new Error(`deleteOrganization failed at step ${failedStep}`);
			(err as any).failedStep = failedStep;
			throw err;
		}

		this.logger.logOk(`[OrgManager] Organización eliminada con cascade: ${orgId}`);
	}

	/** Obtiene todas las organizaciones */
	async getAllOrganizations(token?: string): Promise<Organization[]> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.READ, IdentityScopes.ORGANIZATIONS);

		const orgs = await this.orgModel.find({}).lean();
		return orgs.map((org: any) => this.#toOrganization(org));
	}

	/** Obtiene organizaciones por región */
	async getOrganizationsByRegion(region: string, token?: string): Promise<Organization[]> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.READ, IdentityScopes.ORGANIZATIONS);

		const orgs = await this.orgModel.find({ region });
		return orgs.map((org: any) => this.#toOrganization(org));
	}

	/**
	 * Genera el nombre de la base de datos para una organización
	 * Formato: org_{slug}
	 */
	getDbName(org: Organization): string {
		return `org_${org.slug}`;
	}

	#toOrganization(doc: any): Organization {
		const plainDoc = typeof doc?.toObject === "function" ? doc.toObject() : doc;

		return {
			orgId: plainDoc.orgId,
			slug: plainDoc.slug,
			region: plainDoc.region,
			tier: plainDoc.tier,
			status: plainDoc.status,
			approved: plainDoc.approved ?? false,
			permissions: plainDoc.permissions,
			metadata: plainDoc.metadata,
			createdAt: plainDoc.createdAt,
			updatedAt: plainDoc.updatedAt,
		};
	}
}
