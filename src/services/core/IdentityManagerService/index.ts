import type { Connection } from "mongoose";
import { BaseService } from "../../BaseService.js";
import type { IdentityStats, OrgScopedManagers } from "./types.js";
import type MongoProvider from "../../../providers/object/mongo/index.js";
import { userSchema, groupSchema, roleSchema, organizationSchema, regionSchema, discordGuildConfigSchema } from "./domain/index.js";
import type { DiscordGuildConfig } from "./domain/index.js";
import type { User, Role, Group, Organization, RegionInfo } from "@common/types/identity/index.d.ts";
import { UserManager, GroupManager, RoleManager, PermissionManager, SystemManager, RegionManager, OrgManager } from "./dao/index.js";
import { type IAuthVerifier, type AuthVerifierGetter } from "@common/types/auth-verifier.ts";
import type SessionManagerService from "../../security/SessionManagerService/index.js";
import type OperationsService from "../OperationsService/index.ts";
import { EnableEndpoints, DisableEndpoints } from "../../core/EndpointManagerService/index.js";
import { UserEndpoints } from "./endpoints/users.js";
import { RoleEndpoints } from "./endpoints/roles.js";
import { GroupEndpoints } from "./endpoints/groups.js";
import { OrgEndpoints } from "./endpoints/organizations.js";
import { RegionEndpoints } from "./endpoints/regions.js";
import { StatsEndpoints } from "./endpoints/stats.js";
import { AvatarEndpoints } from "./endpoints/avatar.js";
import type AttachmentsUtility from "../../../utilities/attachments/attachments-utility/index.js";
import type { AttachmentsManager } from "../../../utilities/attachments/attachments-utility/index.js";
import type InternalS3Provider from "../../../providers/object/internal-s3-provider/index.js";
import { userAvatarAttachmentsChecker } from "./permissions/userAvatarAttachments.js";
import { Kernel } from "../../../kernel.ts";

/**
 * IdentityManagerService - Gestión centralizada de identidades, usuarios, roles y grupos
 *
 * **Modo Kernel:**
 * Este servicio se ejecuta en modo kernel (global: true en config.json),
 * lo que significa que está disponible para toda la plataforma.
 *
 * **Persistencia:**
 * Requiere MongoDB para persistir datos. Si no hay un MongoProvider configurado,
 * el servicio lanzará un error.
 *
 * **Multi-tenant:**
 * Soporta múltiples organizaciones con bases de datos aisladas.
 * Usa forOrg(slug, mode) para obtener managers con scope de organización.
 *
 * **Autenticación:**
 * Los managers aceptan un parámetro `token` opcional en cada método.
 * Si se proporciona, se verifican los permisos del usuario antes de ejecutar.
 */
export default class IdentityManagerService extends BaseService {
	public readonly name = "IdentityManagerService";

	// Managers globales
	#userManager: UserManager | null = null;
	#roleManager: RoleManager | null = null;
	#groupManager: GroupManager | null = null;
	#systemManager: SystemManager | null = null;
	#regionManager: RegionManager | null = null;
	#orgManager: OrgManager | null = null;
	#permissionManager: PermissionManager | null = null;

	// Managers internos (sin auth) para uso de servicios de infraestructura (SessionManagerService)
	#internalUserManager: UserManager | null = null;
	#internalOrgManager: OrgManager | null = null;
	#internalRoleManager: RoleManager | null = null;

	// Discord Guild Config model (para mapeo de roles por guild)
	#discordGuildConfigModel: import("mongoose").Model<DiscordGuildConfig> | null = null;

	// AuthVerifier para verificar tokens y permisos
	#authVerifier: IAuthVerifier | null = null;

	// Kernel key para operaciones privilegiadas
	#kernelKey: symbol | null = null;

	// SessionManagerService (lazy-loaded singleton)
	#sessionManager: SessionManagerService | null = null;

	// MongoDB provider
	readonly #mongoProvider: MongoProvider;

	// OperationsService for stepper support in cascade DAOs
	readonly #operationsService: OperationsService;

	// Cache de conexiones por organización
	readonly #orgConnectionCache: Map<string, { connection: Connection; managers: OrgScopedManagers }> = new Map();

	constructor(kernel: Kernel, options?: any) {
		super(kernel, options);
		this.#mongoProvider = this.getMyProvider<MongoProvider>("object/mongo");
		this.#operationsService = kernel.registry.getService<OperationsService>("OperationsService");
	}

	/**
	 * Getter para el AuthVerifier (usado por los managers)
	 */
	readonly #getAuthVerifier: AuthVerifierGetter = () => this.#authVerifier;

	#avatarAttachmentsManager: AttachmentsManager | null = null;

	@EnableEndpoints({
		managers: () => [UserEndpoints, RoleEndpoints, GroupEndpoints, OrgEndpoints, RegionEndpoints, StatsEndpoints, AvatarEndpoints],
	})
	async start(kernelKey: symbol): Promise<void> {
		await super.start(kernelKey);
		this.#kernelKey = kernelKey;

		try {
			// Esperar a que MongoDB esté conectado (máximo 10 segundos)
			const maxWaitTime = 10000;
			const startTime = Date.now();
			while (!this.#mongoProvider.isConnected() && Date.now() - startTime < maxWaitTime) {
				await new Promise((resolve) => setTimeout(resolve, 500));
			}

			if (!this.#mongoProvider.isConnected()) {
				throw new Error("MongoDB no pudo conectarse en el tiempo esperado");
			}

			// Configurar modelos para la base de datos LOCAL (entidades globales)
			const RegionModel = this.#mongoProvider.createModel<RegionInfo>("Region", regionSchema);
			const OrganizationModel = this.#mongoProvider.createModel<Organization>("Organization", organizationSchema);
			const UserModel = this.#mongoProvider.createModel<User>("User", userSchema);
			const RoleModel = this.#mongoProvider.createModel<Role>("Role", roleSchema);
			const GroupModel = this.#mongoProvider.createModel<Group>("Group", groupSchema);
			const DiscordGuildConfigModel = this.#mongoProvider.createModel<DiscordGuildConfig>("DiscordGuildConfig", discordGuildConfigSchema);
			this.#discordGuildConfigModel = DiscordGuildConfigModel;

			// Inicializar RegionManager PRIMERO (necesario para OrgManager)
			this.#regionManager = new RegionManager(RegionModel, OrganizationModel, this.logger, this.#getAuthVerifier);
			await this.#regionManager.initialize();

			// Inicializar managers en orden de dependencia:
			// UserManager (independiente) → GroupManager (→ UserManager) → RoleManager (→ UserManager, GroupManager) → OrgManager (→ todos)
			this.#userManager = new UserManager(UserModel, this.logger, this.#getAuthVerifier);
			this.#groupManager = new GroupManager(GroupModel, this.#userManager, this.logger, this.#getAuthVerifier);
			this.#roleManager = new RoleManager(
				RoleModel,
				this.#userManager,
				this.#groupManager,
				this.logger,
				this.#operationsService,
				this.#getAuthVerifier
			);
			this.#orgManager = new OrgManager(
				OrganizationModel,
				this.#roleManager,
				this.#groupManager,
				this.#userManager,
				this.#regionManager,
				this.logger,
				this.#operationsService,
				this.#getAuthVerifier
			);
			this.#systemManager = new SystemManager(UserModel, RoleModel, GroupModel, this.logger, kernelKey);

			// Managers internos (sin auth verifier) para servicios de infraestructura (SessionManagerService)
			// Usan () => null como AuthVerifierGetter, por lo que requirePermission no aplica
			const noAuth: () => null = () => null;
			this.#internalUserManager = new UserManager(UserModel, this.logger, noAuth);
			const internalGroupManager = new GroupManager(GroupModel, this.#internalUserManager, this.logger, noAuth);
			const internalRoleManager = new RoleManager(
				RoleModel,
				this.#internalUserManager,
				internalGroupManager,
				this.logger,
				this.#operationsService,
				noAuth
			);
			this.#internalRoleManager = internalRoleManager;
			this.#internalOrgManager = new OrgManager(
				OrganizationModel,
				internalRoleManager,
				internalGroupManager,
				this.#internalUserManager,
				this.#regionManager,
				this.logger,
				this.#operationsService,
				noAuth
			);

			// Inicializar roles predefinidos y usuario SYSTEM en BD local
			await this.#roleManager.initializePredefinedRoles();
			await this.#systemManager.initializeSystemUser();

			// Inicializar PermissionManager con cache LRU (usa modelos directamente para evitar recursión de auth)
			this.#permissionManager = new PermissionManager(
				UserModel,
				RoleModel,
				GroupModel,
				OrganizationModel,
				1000, // cache size
				60000 // TTL 1 minuto
			);

			// Crear el AuthVerifier ahora que tenemos todos los componentes
			this.#authVerifier = this.createAuthVerifier();

			// Wire AttachmentsManager para avatares (opcional: si falta S3, los
			// endpoints de subida devolverán 503 hasta que esté disponible).
			try {
				const s3 = this.getMyProvider<InternalS3Provider>("object/internal-s3-provider");
				const attachmentsUtil = this.getMyUtility<AttachmentsUtility>("attachments-utility");
				const connection = this.#mongoProvider.getConnection();
				this.#avatarAttachmentsManager = attachmentsUtil.createAttachmentsManager({
					mongoConnection: connection,
					collectionName: "user_avatar_attachments",
					s3Provider: s3,
					basePath: "user-avatars",
					subPathResolver: (ctx) => ctx.ownerId,
					permissionChecker: userAvatarAttachmentsChecker,
					maxSize: 2 * 1024 * 1024, // 2 MB
					allowedMimeTypes: ["image/jpeg", "image/png", "image/gif", "image/webp"],
					kernelKey,
				});
			} catch (e) {
				this.logger.logWarn(
					`No se pudo inicializar AttachmentsManager de avatares: ${(e as Error).message}. Subida de avatares deshabilitada.`
				);
			}

			// Inicializar endpoint managers
			UserEndpoints.init(this);
			RoleEndpoints.init(this);
			GroupEndpoints.init(this);
			OrgEndpoints.init(this);
			RegionEndpoints.init(this);
			StatsEndpoints.init(this);
			AvatarEndpoints.init(this, UserModel, this.#avatarAttachmentsManager);

			this.logger.logOk("IdentityManagerService iniciado con soporte multi-tenant y autenticación");
		} catch (error: any) {
			this.logger.logError("MongoDB no está disponible. IdentityManagerService requiere MongoDB.");
			throw new Error(`IdentityManagerService requiere MongoDB: ${error.message}`, { cause: error });
		}
	}

	/**
	 * Crea el AuthVerifier que usa SessionManagerService y PermissionManager.
	 * Usado internamente y disponible para otros servicios que necesiten delegar auth.
	 */
	createAuthVerifier(): IAuthVerifier {
		return {
			verifyToken: async (token: string) => {
				// Lazy-load singleton pattern para SessionManagerService Opcional
				if (!this.#sessionManager)
					try {
						this.#sessionManager = this.getMyService<SessionManagerService>("SessionManagerService");
					} catch {
						return { valid: false, error: "SessionManagerService no disponible" };
					}

				const result = await this.#sessionManager.verifyToken(token);
				if (!result.valid || !result.session) {
					return { valid: false, error: result.error || "Token inválido" };
				}

				return { valid: true, userId: result.session.user.id, orgId: result.session.user.orgId };
			},

			hasPermission: async (
				userId: string,
				action: number,
				scope: number,
				orgId?: string,
				resource?: string,
				opts?: { ownerId?: string }
			) => {
				if (!this.#permissionManager) {
					return false;
				}
				return this.#permissionManager.hasPermission(userId, action, scope, orgId, resource, opts);
			},
		};
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Acceso interno para servicios de infraestructura (requiere kernelKey)
	// ─────────────────────────────────────────────────────────────────────────────

	/**
	 * Acceso privilegiado a managers SIN verificación de auth.
	 * Solo para servicios de infraestructura (SessionManagerService) que operan
	 * en contextos pre-autenticación (login, registro, OAuth).
	 * @param kernelKey Clave del kernel para verificar acceso privilegiado
	 */
	_internal(kernelKey: symbol): {
		users: UserManager;
		organizations: OrgManager;
		roles: RoleManager;
		discordGuildId: string | undefined;
		getDiscordRoleMap: (guildId: string) => Promise<Record<string, string> | null>;
	} {
		if (kernelKey !== this.#kernelKey) throw new Error("Acceso denegado: kernelKey inválido");
		const configPrivate = (this.config?.private || {}) as { discordGuildId?: string; discordRoleMap?: Record<string, string> };
		const discordGuildConfigModel = this.#discordGuildConfigModel;

		return {
			users: this.#internalUserManager!,
			organizations: this.#internalOrgManager!,
			roles: this.#internalRoleManager!,
			discordGuildId: configPrivate.discordGuildId,
			/**
			 * Obtiene el mapeo Discord Role ID → nombre de rol de plataforma para un guild.
			 * Primero busca en DB (para guilds custom/por org), fallback a config.json default.
			 */
			getDiscordRoleMap: async (guildId: string): Promise<Record<string, string> | null> => {
				// 1. Buscar config en DB para este guild
				if (discordGuildConfigModel) {
					try {
						const doc = await discordGuildConfigModel.findOne({ guildId });
						if (doc) return (doc.toObject?.() || doc).roleMap;
					} catch {
						/* fallback to config */
					}
				}
				// 2. Fallback: si coincide con el guild default de config.json
				if (guildId === configPrivate.discordGuildId && configPrivate.discordRoleMap) {
					return configPrivate.discordRoleMap;
				}
				return null;
			},
		};
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Getters para acceso a managers globales
	// ─────────────────────────────────────────────────────────────────────────────

	get users(): UserManager {
		if (!this.#userManager) throw new Error("UserManager not initialized");
		return this.#userManager;
	}

	get roles(): RoleManager {
		if (!this.#roleManager) throw new Error("RoleManager not initialized");
		return this.#roleManager;
	}

	get groups(): GroupManager {
		if (!this.#groupManager) throw new Error("GroupManager not initialized");
		return this.#groupManager;
	}

	get system(): SystemManager {
		if (!this.#systemManager) throw new Error("SystemManager not initialized");
		return this.#systemManager;
	}

	get organizations(): OrgManager {
		if (!this.#orgManager) throw new Error("OrgManager not initialized");
		return this.#orgManager;
	}

	get regions(): RegionManager {
		if (!this.#regionManager) throw new Error("RegionManager not initialized");
		return this.#regionManager;
	}

	get permissions(): PermissionManager {
		if (!this.#permissionManager) throw new Error("PermissionManager not initialized");
		return this.#permissionManager;
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Operaciones con scope de organización
	// ─────────────────────────────────────────────────────────────────────────────

	/**
	 * Obtiene managers con scope de organización
	 *
	 * @param orgIdOrSlug - ID o slug de la organización
	 * @param mode - "write" usa región global, "read" puede usar réplica local
	 * @returns Managers para operar dentro de la organización
	 */
	async forOrg(orgIdOrSlug: string, mode: "read" | "write" = "write", token?: string): Promise<OrgScopedManagers> {
		const org = await this.#orgManager!.getOrganization(orgIdOrSlug, token);
		if (!org) {
			throw new Error(`Organización no encontrada: ${orgIdOrSlug}`);
		}

		if (org.status !== "active") {
			throw new Error(`Organización ${org.status}: ${orgIdOrSlug}`);
		}

		// Generar cache key que incluye el modo
		const cacheKey = `${org.orgId}:${mode}`;

		// Verificar cache
		const cached = this.#orgConnectionCache.get(cacheKey);
		if (cached) {
			return cached.managers;
		}

		// Determinar qué región usar según el modo
		let connectionUri: string | null;

		if (mode === "write") {
			// Escrituras siempre van a la región global
			const globalRegion = await this.#regionManager!.getGlobalRegion(token);
			connectionUri = globalRegion.metadata.objectConnectionUri || null;
		} else {
			// Lecturas pueden usar la réplica local de la org
			connectionUri = this.#regionManager!.getObjectConnectionUri(org.region);
		}

		if (!connectionUri) {
			throw new Error(`No hay connectionUri configurado para región: ${org.region}`);
		}

		// Obtener/crear conexión
		const regionConnection = await this.#mongoProvider.getOrCreateConnection(connectionUri);

		// Cambiar a la base de datos de la organización
		const dbName = this.#orgManager!.getDbName(org);
		const orgDbConnection = this.#mongoProvider.useDb(regionConnection, dbName);

		// Crear modelos para la base de datos de la organización
		const OrgUserModel = this.#mongoProvider.createModelForDb<User>(orgDbConnection, "User", userSchema);
		const OrgRoleModel = this.#mongoProvider.createModelForDb<Role>(orgDbConnection, "Role", roleSchema);
		const OrgGroupModel = this.#mongoProvider.createModelForDb<Group>(orgDbConnection, "Group", groupSchema);

		// Crear managers con scope de organización (misma cadena de dependencia)
		const orgUserManager = new UserManager(OrgUserModel, this.logger, this.#getAuthVerifier);
		const orgGroupManager = new GroupManager(OrgGroupModel, orgUserManager, this.logger, this.#getAuthVerifier);
		const orgRoleManager = new RoleManager(
			OrgRoleModel,
			orgUserManager,
			orgGroupManager,
			this.logger,
			this.#operationsService,
			this.#getAuthVerifier
		);

		const managers: OrgScopedManagers = {
			org,
			users: orgUserManager,
			roles: orgRoleManager,
			groups: orgGroupManager,

			// Inicializa la base de datos de la org (roles predefinidos, etc.)
			initialize: async () => {
				await orgRoleManager.initializePredefinedRoles(org.orgId);
				this.logger.logOk(`[IdentityManager] Base de datos inicializada para org: ${org.slug}`);
			},
		};

		// Cachear
		this.#orgConnectionCache.set(cacheKey, {
			connection: orgDbConnection,
			managers,
		});

		return managers;
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Métodos de servicio
	// ─────────────────────────────────────────────────────────────────────────────

	async getStats(token?: string): Promise<IdentityStats> {
		const baseStats = await this.#systemManager!.getStats();
		const orgs = await this.#orgManager!.getAllOrganizations(token);
		const regions = await this.#regionManager!.getAllRegions(token);

		return {
			...baseStats,
			totalOrganizations: orgs.length,
			totalRegions: regions.length,
		};
	}

	@DisableEndpoints()
	async stop(kernelKey: symbol): Promise<void> {
		// Limpiar cache de conexiones por organización
		this.#orgConnectionCache.clear();

		await super.stop(kernelKey);
		this.#systemManager?.clearSystemUser(kernelKey);
		this.#authVerifier = null;

		this.logger.logOk("IdentityManagerService detenido");
	}
}
