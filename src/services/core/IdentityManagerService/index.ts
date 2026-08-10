import type { Connection, Model } from "mongoose";
import { BaseService } from "../../BaseService.js";
import type { BilingualNote, IdentityStats, OrgScopedManagers, UserDataExportDocument, UserDataExportSection } from "./types.js";
import type MongoProvider from "../../../providers/object/mongo/index.js";
import { userSchema, groupSchema, roleSchema, organizationSchema, regionSchema, discordGuildConfigSchema } from "./domain/index.js";
import type { DiscordGuildConfig } from "./domain/index.js";
import type { User, Role, Group, Organization, RegionInfo } from "@common/types/identity/index.d.ts";
import {
	UserManager,
	GroupManager,
	RoleManager,
	PermissionManager,
	SystemManager,
	RegionManager,
	OrgManager,
	LegalAcceptanceArchiver,
	buildLegalAcceptanceArchiveSchema,
	LEGAL_ACCEPTANCE_ARCHIVE_DEFAULT_RETENTION_DAYS,
	type LegalAcceptanceArchiveRecord,
	type SessionRevoker,
	type SubscriptionCanceller,
	type SelfDeletionCancelledHook,
} from "./dao/index.js";
import { seedDevUsers, purgeDevUsers } from "./dao/devSeeder.js";
import { SystemRole } from "./defaults/systemRoles.js";
import { NotifyManager } from "./notify.js";
import { type IAuthVerifier, type AuthVerifierGetter } from "@common/types/auth-verifier.ts";
import type { ISubscriptionService } from "@common/types/subscriptions/index.ts";
import type { ISessionManagerService } from "@common/types/identity/ISessionManagerService.js";
import type { IModerationService } from "@common/types/identity/IModerationService.js";
import type { IOperationsService } from "@common/types/operations/IOperationsService.js";
import type { IIdleOrchestrator } from "@common/types/operations/IIdleOrchestrator.js";
import type { Step } from "../OperationsService/index.ts";
import { EnableEndpoints, DisableEndpoints } from "../../core/EndpointManagerService/index.js";
import { OnlyKernel } from "../../../utils/decorators/OnlyKernel.ts";
import {
	UserEndpoints,
	RoleEndpoints,
	GroupEndpoints,
	OrgEndpoints,
	RegionEndpoints,
	StatsEndpoints,
	AvatarEndpoints,
} from "./endpoints/index.js";
import type AttachmentsUtility from "../../../utilities/attachments/attachments-utility/index.js";
import type { AttachmentsManager } from "../../../utilities/attachments/attachments-utility/index.js";
import { Scope, assertScope, type CapabilityToken } from "@common/security/Capability.ts";
import { buildInternalApi, buildDiscordApi, type IdentityInternalApi, type IdentityAvatarApi, type IdentityDiscordApi } from "./internal.js";
import {
	AVATAR_ALLOWED_MIME_TYPES,
	AVATAR_MAX_SIZE_BYTES,
	backfillRemoteAvatars,
	ingestProviderAvatar,
	type AvatarIngestDeps,
} from "./avatarIngest.js";
import { createEmailBinder, type EmailBinder } from "./emailBinding.js";
import type InternalS3Provider from "../../../providers/object/internal-s3-provider/index.js";
import { userAvatarAttachmentsChecker } from "./permissions/userAvatarAttachments.js";
import { Kernel } from "../../../kernel.ts";
import type { QuotaTrackerGetter } from "@common/types/storage/quota.ts";
import { forEachPage } from "@common/utils/batch.ts";
import { createQuotaTrackerGetter } from "../../data/StorageQuotaService/index.js";
import type { IStorageQuotaService } from "@common/types/storage/IStorageQuotaService.js";
import { createSeatGate, type SeatGate } from "@common/types/plans/consumers.js";
import type { IPlanService } from "@common/types/plans/IPlanService.js";
import type { IAuditLogService } from "@common/types/security/AuditLog.ts";
import type { INotificationEmailSender } from "@common/types/notifications/INotificationService.ts";
import type { IMailboxRenamer } from "@common/types/email/Email.ts";
import { sha256Bytes, sha256Hex } from "@common/utils/crypto.ts";
import { sanitizeUserMetadata } from "@common/utils/user-metadata.ts";
import LRUCache from "@adc/utils/performance/LRUCache.ts";

/** Organizaciones (× modo read/write) con managers vivos a la vez. */
const ORG_MANAGERS_CACHE_SIZE = 200;

/** Entrada de `#orgManagersCache`: managers + la vista/dbName que hay que liberar al desalojar. */
interface CachedOrgManagers {
	managers: OrgScopedManagers;
	connection: Connection;
	dbName: string;
}

/**
 * Espera antes de la primera corrida del purge de retención: da tiempo a que
 * carguen los presets con datos privados (Drive, PM, Email), que arrancan
 * después de Identity. Las corridas siguientes van por el interval de 6h.
 */
const INITIAL_RETENTION_PURGE_DELAY_MS = 5 * 60 * 1000;

/** Versión del formato del export de datos personales (subir ante cambios incompatibles). */
const USER_DATA_EXPORT_FORMAT_VERSION = 1;

/**
 * Composición FIJA de los pasos de la cascada de purga, en orden estable e independiente de qué
 * preset esté cargado. Cambiarla cambia el hash de composición: los docs viejos del stepper dejan
 * de reanudarse y la cascada re-corre completa (seguro: los purgers son idempotentes).
 * StorageQuotaService va aparte y ÚLTIMO (excepción de ciclo, ver `#getUserDataPurgers`).
 */
const USER_DATA_PURGER_CANDIDATES: ReadonlyArray<{ service: string; method: string }> = [
	{ service: "ProjectManagerService", method: "purgeUserPrivateData" },
	{ service: "EmailService", method: "purgeUserData" },
	{ service: "DriveService", method: "purgeUserPrivateData" },
	{ service: "NotificationService", method: "purgeUserData" },
	{ service: "content-service", method: "purgeUserData" },
	{ service: "SubscriptionService", method: "purgeUserData" },
];

/**
 * Servicio opcional capaz de purgar datos privados de un usuario tras la
 * retención. Se resuelve perezosamente para no acoplar el kernel a presets.
 */
interface UserDataPurger {
	name: string;
	run: (userId: string) => Promise<void>;
}

import type { IIdentityManagerService, PublicUserManager } from "@common/types/identity/IIdentityManagerService.ts";

/**
 * Vista **pública** del UserManager: excluye las primitivas de credenciales pre-auth
 * (`authenticate`, `verifyUserPassword`), que no deben estar en la superficie que se
 * pasa libremente entre módulos (oráculo de password). Quedan accesibles sólo vía
 * `_internal(kernelKey)` para la infraestructura de auth (SessionManager, login).
 */
export type { PublicUserManager };

/**
 * Gestión centralizada de identidades, usuarios, roles y grupos.
 *
 * Requiere un MongoProvider configurado; sin él el arranque falla. Es multi-tenant:
 * cada organización vive en una base aislada y se accede vía `forOrg(slug, mode)`.
 *
 * Los managers aceptan un `token` opcional por método: si viene, verifican los
 * permisos del usuario antes de ejecutar; si no, la llamada va sin autorizar.
 */
export default class IdentityManagerService extends BaseService implements IIdentityManagerService {
	public readonly name = "IdentityManagerService";

	// Managers globales
	#userManager: UserManager | null = null;
	#roleManager: RoleManager | null = null;
	#groupManager: GroupManager | null = null;
	#systemManager: SystemManager | null = null;
	#regionManager: RegionManager | null = null;
	#orgManager: OrgManager | null = null;
	#permissionManager: PermissionManager | null = null;
	readonly #notifyManager: NotifyManager = new NotifyManager((input) => this.emitSecureNotification(input));

	// Managers internos (sin auth) para uso de servicios de infraestructura (ISessionManagerService)
	#internalUserManager: UserManager | null = null;
	#internalOrgManager: OrgManager | null = null;
	#internalRoleManager: RoleManager | null = null;

	/** Vinculación neutral de emails (alta y rectificación); se arma en `start()`. */
	#bindEmailNeutrally: EmailBinder | null = null;

	// Discord Guild Config model (para mapeo de roles por guild)
	#discordGuildConfigModel: Model<DiscordGuildConfig> | null = null;

	// AuthVerifier para verificar tokens y permisos
	#authVerifier: IAuthVerifier | null = null;

	// Kernel key para operaciones privilegiadas
	#kernelKey: symbol | null = null;

	// ISessionManagerService (lazy-loaded singleton)
	#sessionManager: ISessionManagerService | null = null;

	/**
	 * Corta las sesiones vivas de una cuenta que se acaba de desactivar (ban, baja,
	 * desactivación administrativa). Se inyecta en `UserManager` porque el DAO no puede
	 * resolver servicios; acá sí, con el mismo lazy-load que usa `createAuthVerifier`.
	 *
	 * Es **best-effort a propósito**: SessionManagerService carga después que Identity
	 * (kernelMode 70 vs 60) y puede no estar disponible. Que el corte de sesión falle no
	 * puede impedir el ban — el chequeo de `isActive` en `/api/auth/refresh` es la otra
	 * mitad de la defensa y no depende de esta llamada.
	 */
	readonly #revokeSessions: SessionRevoker = async (userId: string, reason: string) => {
		const session = this.#resolveSessionManager();
		if (!session) {
			this.logger.logWarn(`[Identity] SessionManagerService no disponible: sesiones de ${userId} no revocadas (${reason})`);
			return;
		}
		const revoked = await session.revokeUserSessions(this.getCapability(), userId);
		this.logger.logInfo(`[Identity] ${revoked} sesión(es) revocadas para ${userId} (${reason})`);
	};

	/**
	 * Avisa y deja rastro cuando la baja se cancela al volver a entrar. Best-effort y sin `await`:
	 * cancelar es la dirección benigna y no puede bloquearse por notificaciones o auditoría caídas.
	 */
	readonly #onSelfDeletionCancelled: SelfDeletionCancelledHook = (userId: string, via: "login") => {
		void this.notifications(this.getCapability()).accountDeletionCancelled(userId);
		void this.getAuditWriter()?.record(this.getCapability(), {
			action: "identity.cancel-deletion",
			actorUserId: userId,
			targetUserId: userId,
			targetResource: "identity:user",
			context: { via },
		});
	};

	/** Lazy-load singleton de `ISessionManagerService`; `null` si todavía no está cargado. */
	#resolveSessionManager(): ISessionManagerService | null {
		if (!this.#sessionManager) {
			try {
				this.#sessionManager = this.getMyService<ISessionManagerService>("SessionManagerService");
			} catch {
				return null;
			}
		}
		return this.#sessionManager;
	}

	/**
	 * Corta el débito recurrente al pedir la baja de la cuenta. Sin esto la suscripción
	 * sigue cobrando sobre una cuenta programada para borrarse.
	 *
	 * Resolución perezosa y sin cache, como el resto de los presets: SubscriptionService
	 * es kernelMode 85 y declara a Identity, así que sólo puede ser una dependencia
	 * `optional` resuelta en el momento de uso. Si falla, `requestSelfDeletion` deja el
	 * `logError` — la baja no se revierte, pero el cobro pendiente queda asentado.
	 */
	readonly #cancelSubscription: SubscriptionCanceller = async (userId: string) => {
		const subscriptions = this.tryGetMyService<ISubscriptionService>("SubscriptionService");
		if (!subscriptions) {
			this.logger.logWarn(`[Identity] SubscriptionService no disponible: no se canceló la suscripción de ${userId}`);
			return;
		}
		const cancelled = await subscriptions.cancelFor(userId, null);
		if (cancelled) this.logger.logInfo(`[Identity] Suscripción de ${userId} cancelada por baja de cuenta`);
	};

	// Nota: ModerationService y los purgers de presets se resuelven SIEMPRE en el
	// momento de uso (lazy, sin cache de instancias): los presets cargan después de
	// Identity (kernelMode 60) y pueden hot-reloadearse; cachear una instancia acá
	// dejaría una referencia vieja.

	// Timer para limpieza periódica de cuentas con retención vencida.
	#retentionTimer: ReturnType<typeof setInterval> | null = null;
	#initialPurgeTimer: ReturnType<typeof setTimeout> | null = null;
	#tierGrantTimer: ReturnType<typeof setInterval> | null = null;

	/** Archivo anonimizado de constancias de aceptación legal (paso final de la purga). */
	#legalArchiver: LegalAcceptanceArchiver | null = null;

	/** Base de la página pública de cancelación de baja (adc-auth `/cancel-deletion`). */
	#cancelDeletionUrlBase = "";

	/** Base de la página pública de confirmación de cambio de email (adc-auth `/confirm-email`). */
	#emailChangeConfirmUrlBase = "";

	readonly #mongoProvider: MongoProvider;

	// IOperationsService for stepper support in cascade DAOs
	readonly #operationsService: IOperationsService;

	/**
	 * Managers por organización. Acotado: cada entrada retiene tres modelos compilados y con un Map
	 * crecía una entrada por org (× modo) hasta el `stop()` del servicio. El `onEvict` libera además
	 * la vista de mongoose que sostiene esos modelos; sin eso, la LRU acotaría el objeto de
	 * aplicación pero no la memoria real.
	 */
	readonly #orgManagersCache = new LRUCache<string, CachedOrgManagers>(ORG_MANAGERS_CACHE_SIZE, (_key, cached) =>
		this.#mongoProvider.releaseDbView(cached.connection, cached.dbName)
	);

	/** Conexión por URI de región: acotada por la cantidad de regiones, no por orgs. */
	readonly #regionConnections = new Map<string, Connection>();

	/** Tracker de cuota lazy: StorageQuotaService carga después (kernelMode mayor). */
	readonly #getQuotaTracker: QuotaTrackerGetter;

	/** Resolver lazy de StorageQuotaService (excepción de ciclo: ver constructor). */
	readonly #getStorageQuotaService: () => IStorageQuotaService | undefined;

	/** Gate de asientos lazy: PlanService carga después (kernelMode mayor). */
	readonly #seatGate: SeatGate;

	constructor(kernel: Kernel, options?: any) {
		super(kernel, options);
		// Excepción de ciclo: Identity NO puede declarar StorageQuotaService (StorageQuota
		// depende de Identity), así que resuelve por nombre fijo vía el reader del kernel.
		// `getPlatformService` (identidad pinneada en boot): el purger de contadores le
		// reenvía la capability de Identity, y para eso el nombre a secas no alcanza.
		this.#getStorageQuotaService = () => kernel.getReadonlyRegistry().getPlatformService<IStorageQuotaService>("StorageQuotaService");
		this.#getQuotaTracker = createQuotaTrackerGetter(this.#getStorageQuotaService);
		// Mismo ciclo con PlanService (declara Identity): resolución perezosa por nombre.
		this.#seatGate = createSeatGate(() => kernel.getReadonlyRegistry().getService<IPlanService>("PlanService"));
		this.#mongoProvider = this.getMyProvider<MongoProvider>("object/mongo");
		this.#operationsService = this.getMyService<IOperationsService>("OperationsService");
	}

	/**
	 * Getter para el AuthVerifier (usado por los managers)
	 */
	readonly #getAuthVerifier: AuthVerifierGetter = () => this.#authVerifier;

	#avatarAttachmentsManager: AttachmentsManager | null = null;

	@OnlyKernel()
	@EnableEndpoints({
		managers: () => [UserEndpoints, RoleEndpoints, GroupEndpoints, OrgEndpoints, RegionEndpoints, StatsEndpoints, AvatarEndpoints],
	})
	async start(kernelKey: symbol): Promise<void> {
		await super.start(kernelKey);
		this.#kernelKey = kernelKey;

		try {
			await this.waitForProvider(this.#mongoProvider, "MongoDB");

			// Configurar modelos para la base de datos LOCAL (entidades globales)
			const RegionModel = this.#mongoProvider.createModel<RegionInfo>("Region", regionSchema);
			const OrganizationModel = this.#mongoProvider.createModel<Organization>("Organization", organizationSchema);
			const UserModel = this.#mongoProvider.createModel<User>("User", userSchema);
			const RoleModel = this.#mongoProvider.createModel<Role>("Role", roleSchema);
			const GroupModel = this.#mongoProvider.createModel<Group>("Group", groupSchema);
			const DiscordGuildConfigModel = this.#mongoProvider.createModel<DiscordGuildConfig>("DiscordGuildConfig", discordGuildConfigSchema);
			this.#discordGuildConfigModel = DiscordGuildConfigModel;

			// Inicializar RegionManager PRIMERO (necesario para OrgManager)
			const defaultRegionObjectUri =
				(this.config?.private as { defaultRegionObjectUri?: string } | undefined)?.defaultRegionObjectUri ||
				"mongodb://localhost:27017/adc-platform";
			this.#regionManager = new RegionManager(RegionModel, OrganizationModel, this.logger, defaultRegionObjectUri, this.#getAuthVerifier);
			await this.#regionManager.initialize();

			// Secreto de baja de cuentas: firma los tokens de arrepentimiento y de cambio de email,
			// y seudonimiza el archivo de constancias. Cada uso deriva su sub-clave por etiqueta.
			const deletionCfg =
				(this.config?.private as { accountDeletion?: { secret?: string; cancelUrl?: string; legalArchiveRetentionDays?: number | string } })
					?.accountDeletion ?? {};
			const deletionSecret = this.#resolveAccountDeletionSecret(deletionCfg.secret);
			this.#cancelDeletionUrlBase = (deletionCfg.cancelUrl || "https://auth.adigitalcafe.com/cancel-deletion").trim();

			const emailChangeCfg = (this.config?.private as { emailChange?: { confirmUrl?: string } })?.emailChange ?? {};
			this.#emailChangeConfirmUrlBase = (emailChangeCfg.confirmUrl || "https://auth.adigitalcafe.com/confirm-email").trim();

			// Inicializar managers en orden de dependencia:
			// UserManager (independiente) → GroupManager (→ UserManager) → RoleManager (→ UserManager, GroupManager) → OrgManager (→ todos)
			// El gate de asientos va SOLO en el manager con auth: los managers internos sirven
			// a infraestructura (sesiones, seeds) y no deben quedar bloqueados por un límite comercial.
			this.#userManager = new UserManager(
				UserModel,
				this.logger,
				this.#getAuthVerifier,
				this.#seatGate,
				this.#revokeSessions,
				this.#cancelSubscription,
				deletionSecret,
				this.#onSelfDeletionCancelled
			);
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

			// Managers internos (sin auth verifier) para servicios de infraestructura (ISessionManagerService)
			// Usan () => null como AuthVerifierGetter, por lo que requirePermission no aplica
			const noAuth: () => null = () => null;
			this.#internalUserManager = new UserManager(
				UserModel,
				this.logger,
				noAuth,
				undefined,
				this.#revokeSessions,
				undefined,
				deletionSecret,
				this.#onSelfDeletionCancelled
			);
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
			// Ojo: el `RegionManager` es el ÚNICO y va con auth verifier (su cache se poblaría dos
			// veces si hubiera otro). Por eso el manager interno es "sin auth" en todo menos en las
			// validaciones de región: un caller interno no debe pasar `region` en `create`/`update`
			// de organización, o `getRegion` va a exigir un token que no tiene.
			// Hoy nadie lo hace (el único uso interno es el patch de `tier` de adc-subscriptions).
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

			// Vinculación neutral de emails: la usan el alta (vía `_internal`) y `/me/change-email`.
			// Va sobre el manager INTERNO porque el alta corre pre-sesión, sin token que autorizar.
			this.#bindEmailNeutrally = createEmailBinder({
				users: this.#internalUserManager,
				logger: this.logger,
				cap: this.getCapability(),
				getSender: () => this.getSystemEmailSender(),
				getAudit: () => this.getAuditWriter(),
				buildConfirmUrl: (confirmToken) => this.buildEmailChangeConfirmUrl(confirmToken),
			});

			// Inicializar roles predefinidos y usuario SYSTEM en BD local.
			// El sync propaga cambios de systemRoles.ts a la BD (el PermissionManager
			// se crea después con cache vacío, no hace falta invalidar acá).
			const rolesSynced = await this.#roleManager.initializePredefinedRoles();
			if (rolesSynced) this.logger.logOk("Roles predefinidos sincronizados con systemRoles.ts");
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

			// Dev: sembrar usuarios de prueba (Admin global, Admin de org, …) con roles
			// concretos. Idempotente y declarativo (ver defaults/devUsers.ts).
			if (process.env.NODE_ENV === "development") {
				try {
					await seedDevUsers({
						userModel: UserModel,
						roleModel: RoleModel,
						orgModel: OrganizationModel,
						roles: this.#roleManager,
						passwords: (this.config?.private as { devUserPasswords?: Record<string, string> } | undefined)?.devUserPasswords ?? {},
						logger: this.logger,
					});
					this.#permissionManager.invalidateAll();
				} catch (err: any) {
					this.logger.logWarn(`[DevSeed] No se pudieron sembrar usuarios de dev: ${err?.message || err}`);
				}
			} else {
				// Fuera de development: por precaución, purgar cualquier usuario/org de
				// dev (credenciales conocidas) que pudiera haber quedado en la BD.
				try {
					await purgeDevUsers({
						userModel: UserModel,
						roleModel: RoleModel,
						orgModel: OrganizationModel,
						logger: this.logger,
					});
					this.#permissionManager.invalidateAll();
				} catch (err: any) {
					this.logger.logWarn(`[DevSeed] No se pudieron purgar usuarios de dev: ${err?.message || err}`);
				}
			}

			// Wire AttachmentsManager para avatares (opcional: si falta S3, los
			// endpoints de subida devolverán 503 hasta que esté disponible).
			try {
				// Getter, no instancia: el provider se resuelve en cada uso para que una recarga
				// en caliente no deje al manager hablándole a una instancia detenida.
				const s3 = () => this.getMyProvider<InternalS3Provider>("object/internal-s3-provider");
				const attachmentsUtil = this.getMyUtility<AttachmentsUtility>("attachments-utility");
				const connection = this.#mongoProvider.getConnection();
				this.#avatarAttachmentsManager = attachmentsUtil.createAttachmentsManager({
					mongoConnection: connection,
					collectionName: "user_avatar_attachments",
					s3Provider: s3,
					basePath: "user-avatars",
					subPathResolver: (ctx) => ctx.ownerId,
					permissionChecker: userAvatarAttachmentsChecker,
					// Misma política para la subida manual y para la ingesta del avatar OAuth.
					maxSize: AVATAR_MAX_SIZE_BYTES,
					allowedMimeTypes: AVATAR_ALLOWED_MIME_TYPES,
					kernelKey,
					quota: { appId: "avatars", getTracker: this.#getQuotaTracker },
					logger: this.logger,
				});
			} catch (e) {
				this.logger.logWarn(
					`No se pudo inicializar AttachmentsManager de avatares: ${(e as Error).message}. Subida de avatares deshabilitada.`
				);
			}

			this.#registerAvatarBackfill();

			// Destinatarios de alertas de seguridad: Admins + Security Managers GLOBALES
			// (roles con orgId nulo; el lookup por nombre a secas podría matchear roles de org).
			this.#notifyManager.setSecurityRecipientsResolver(async () => {
				const roles = await RoleModel.find(
					{ name: { $in: [SystemRole.ADMIN, SystemRole.SECURITY_MANAGER] }, orgId: null },
					{ id: 1 }
				).lean();
				const roleIds = roles.map((r) => r.id);
				if (!roleIds.length) return [];
				const users = await UserModel.find({ roleIds: { $in: roleIds } }, { id: 1 })
					.limit(200)
					.lean();
				return users.map((u) => u.id);
			});

			// Inicializar endpoint managers
			UserEndpoints.init(this, this.getCapability());
			RoleEndpoints.init(this, this.getCapability());
			GroupEndpoints.init(this);
			OrgEndpoints.init(this);
			RegionEndpoints.init(this);
			StatsEndpoints.init(this);
			// Lookup mínimo para el endpoint público de avatar raw, vía el manager
			// interno (sin auth): los endpoints no tocan models (ver endpoints.md).
			AvatarEndpoints.init(this, (userId) => this.#internalUserManager!.getAvatarAttachmentId(userId), this.#avatarAttachmentsManager);

			// Archivo anonimizado de constancias legales, que el paso final de la purga escribe
			// ANTES del hard delete. Índices con syncIndexes() (ver `buildLegalAcceptanceArchiveSchema`).
			const legalRetentionDays = Number(deletionCfg.legalArchiveRetentionDays);
			const legalRetentionSecs =
				(Number.isFinite(legalRetentionDays) && legalRetentionDays > 0
					? legalRetentionDays
					: LEGAL_ACCEPTANCE_ARCHIVE_DEFAULT_RETENTION_DAYS) *
				24 *
				60 *
				60;
			const legalArchiveModel = this.#mongoProvider.createModel<LegalAcceptanceArchiveRecord>(
				"LegalAcceptanceArchive",
				buildLegalAcceptanceArchiveSchema(legalRetentionSecs)
			);
			try {
				await legalArchiveModel.syncIndexes();
			} catch (err: any) {
				this.logger.logWarn(`syncIndexes de legal_acceptance_archive falló: ${err?.message || err}`);
			}
			this.#legalArchiver = new LegalAcceptanceArchiver(
				legalArchiveModel,
				sha256Bytes(`legal-acceptance-archive:${deletionSecret}`),
				this.logger
			);

			// Cron de retención: purga usuarios con `metadata.scheduledDeletionAt < now`.
			// TODA baja (voluntaria, administrativa o por ban) pasa por acá: el único hard
			// delete es el último paso del stepper, condicional a que la baja siga vigente.
			// La corrida inicial se DIFIERE: Identity carga antes que los presets con datos
			// privados (Drive, PM, Email); purgar un usuario vencido en pleno boot borraría
			// su registro sin ejecutar esos purgers (datos huérfanos irrecuperables).
			this.#initialPurgeTimer = setTimeout(
				() => this.#runRetentionPurge().catch((err) => this.logger.logWarn(`Retention purge inicial falló: ${err?.message || err}`)),
				INITIAL_RETENTION_PURGE_DELAY_MS
			);
			this.#retentionTimer = setInterval(
				() => this.#runRetentionPurge().catch((err) => this.logger.logWarn(`Retention purge falló: ${err?.message || err}`)),
				6 * 60 * 60 * 1000
			);

			// Cron de reversión de grants de tier temporales (bug bounty): revierte
			// `metadata.accountTier` a `previousTier` cuando `tierGrant.expiresAt <= now`.
			this.#runTierGrantRevert().catch((err) => this.logger.logWarn(`Tier grant revert inicial falló: ${err?.message || err}`));
			this.#tierGrantTimer = setInterval(
				() => this.#runTierGrantRevert().catch((err) => this.logger.logWarn(`Tier grant revert falló: ${err?.message || err}`)),
				60 * 60 * 1000
			);

			this.logger.logOk("IdentityManagerService iniciado con soporte multi-tenant y autenticación");
		} catch (error: any) {
			this.logger.logError("MongoDB no está disponible. IdentityManagerService requiere MongoDB.");
			throw new Error(`IdentityManagerService requiere MongoDB: ${error.message}`, { cause: error });
		}
	}

	/**
	 * Crea el AuthVerifier que usa ISessionManagerService y PermissionManager.
	 * Usado internamente y disponible para otros servicios que necesiten delegar auth.
	 */
	createAuthVerifier(): IAuthVerifier {
		return {
			verifyToken: async (token: string) => {
				// Lazy-load singleton pattern para ISessionManagerService Opcional
				if (!this.#sessionManager)
					try {
						this.#sessionManager = this.getMyService<ISessionManagerService>("SessionManagerService");
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

	// Acceso interno para infraestructura, **separado por scope** (least‑privilege).
	// Implementación en `./internal.ts` para no inflar este shell. Durante la transición
	// `assertScope` acepta también la master key (`this.#kernelKey`); el flip la retira.

	/** Managers de users/orgs/roles SIN auth (pre‑auth: login/registro/OAuth). Scope `identity:internal`. */
	_internal(token: CapabilityToken): IdentityInternalApi {
		assertScope(token, Scope.IdentityInternal);
		return buildInternalApi(
			this.#internalUserManager!,
			this.#internalOrgManager!,
			this.#internalRoleManager!,
			this.#bindEmailNeutrally!,
			(userId, remoteAvatarUrl) => this.#ingestProviderAvatar(userId, remoteAvatarUrl)
		);
	}

	/** Dependencias de la ingesta de avatares: managers internos + el manager de adjuntos vigente. */
	#avatarIngestDeps(): AvatarIngestDeps {
		return {
			users: this.#internalUserManager!,
			attachments: () => this.#avatarAttachmentsManager,
			logger: this.logger,
		};
	}

	/** Ver `IdentityInternalApi.ingestProviderAvatar`. Nunca lanza. */
	async #ingestProviderAvatar(userId: string, remoteAvatarUrl?: string): Promise<void> {
		if (!this.#internalUserManager) return;
		await ingestProviderAvatar(this.#avatarIngestDeps(), userId, remoteAvatarUrl);
		this.#permissionManager?.invalidateUser(userId);
	}

	/**
	 * Barrido de las cuentas anteriores a la ingesta, que todavía guardan la URL del CDN del
	 * proveedor. Va como trabajo de momento ocioso —de a lotes chicos, cada uno con su petición
	 * saliente— y se apaga solo cuando no queda ninguna.
	 */
	#registerAvatarBackfill(): void {
		try {
			// Registrar de más: sin el orquestador el barrido simplemente no corre — no es motivo
			// para que Identity (kernelMode 60) no arranque.
			this.tryGetMyService<IIdleOrchestrator>("OperationsService")?.registerIdleJob(this.getCapability(), {
				id: "avatar-remote-backfill",
				description: "Ingesta los avatares que todavía apuntan al CDN del proveedor OAuth",
				intervalMs: 60_000,
				batchBudgetMs: 5_000,
				run: (ctx) => backfillRemoteAvatars(this.#avatarIngestDeps(), ctx),
			});
		} catch (err: any) {
			this.logger.logWarn(`[avatar] backfill de avatares remotos no registrado: ${err?.message || err}`);
		}
	}

	/** Agregación de uso de avatares para cuota. Scope `identity:avatar`. */
	_internalAvatar(token: CapabilityToken): IdentityAvatarApi {
		assertScope(token, Scope.IdentityAvatar);
		const mgr = this.#avatarAttachmentsManager;
		const key = this.#kernelKey;
		// `aggregateUsageByUser` va pre‑ligado al token de Identity: StorageQuota no cruza key.
		return { avatarAttachments: mgr && key ? { aggregateUsageByUser: () => mgr.aggregateUsageByUser(key) } : null };
	}

	/** Mapeo de roles Discord (DB por guild con fallback a config). Scope `identity:discord`. */
	_internalDiscord(token: CapabilityToken): IdentityDiscordApi {
		assertScope(token, Scope.IdentityDiscord);
		const configPrivate = (this.config?.private || {}) as { discordGuildId?: string; discordRoleMap?: Record<string, string> };
		return buildDiscordApi(this.#discordGuildConfigModel, configPrivate);
	}

	// Getters para acceso a managers globales

	get users(): PublicUserManager {
		if (!this.#userManager) throw new Error("UserManager not initialized");
		return this.#userManager;
	}

	/**
	 * Notificaciones de dominio de identidad/seguridad (ej. cambio de contraseña).
	 * Requiere capability con scope `identity:internal`: un módulo sin ese scope no puede
	 * emitir avisos de seguridad spoofeados (p.ej. "tu contraseña cambió") a usuarios arbitrarios.
	 */
	notifications(token: CapabilityToken): NotifyManager {
		assertScope(token, Scope.IdentityInternal);
		return this.#notifyManager;
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

	// Operaciones con scope de organización

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

		const cached = this.#orgManagersCache.get(cacheKey);
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

		// Obtener/crear conexión (una sola toma del pool por región, no una por org)
		const regionConnection = await this.#getRegionConnection(connectionUri);

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

		this.#orgManagersCache.set(cacheKey, { managers, connection: regionConnection, dbName });

		return managers;
	}

	async #getRegionConnection(connectionUri: string): Promise<Connection> {
		const cached = this.#regionConnections.get(connectionUri);
		if (cached) return cached;
		const connection = await this.#mongoProvider.getOrCreateConnection(connectionUri);
		this.#regionConnections.set(connectionUri, connection);
		return connection;
	}

	// Métodos de servicio

	async getStats(token?: string): Promise<IdentityStats> {
		const baseStats = await this.#systemManager!.getStats();
		const totalOrganizations = await this.#orgManager!.countOrganizations(token);
		const regions = await this.#regionManager!.getAllRegions(token);

		return {
			...baseStats,
			totalOrganizations,
			totalRegions: regions.length,
		};
	}

	@OnlyKernel()
	@DisableEndpoints()
	async stop(kernelKey: symbol): Promise<void> {
		this.#orgManagersCache.clear();
		this.#regionConnections.clear();
		this.tryGetMyService<IIdleOrchestrator>("OperationsService")?.unregisterIdleJobs(this.getCapability());

		if (this.#retentionTimer) {
			clearInterval(this.#retentionTimer);
			this.#retentionTimer = null;
		}

		if (this.#initialPurgeTimer) {
			clearTimeout(this.#initialPurgeTimer);
			this.#initialPurgeTimer = null;
		}

		if (this.#tierGrantTimer) {
			clearInterval(this.#tierGrantTimer);
			this.#tierGrantTimer = null;
		}

		await super.stop(kernelKey);
		this.#systemManager?.clearSystemUser(kernelKey);
		this.#authVerifier = null;
		this.#legalArchiver = null;

		this.logger.logOk("IdentityManagerService detenido");
	}

	/**
	 * `ACCOUNT_DELETION_SECRET`, o uno de desarrollo (público) con warning. Misma política que la
	 * pepper de bans: en producción hay que setearlo o los tokens son forjables.
	 */
	#resolveAccountDeletionSecret(raw?: string): string {
		const secret = raw?.trim();
		if (secret) return secret;
		this.logger.logWarn(
			"[Identity] ACCOUNT_DELETION_SECRET no configurado: usando un secreto de desarrollo. " +
				"Configuralo en producción (openssl rand -hex 32) o los tokens de cancelación de baja serán forjables."
		);
		return "adc-identity-dev-account-deletion-secret";
	}

	buildCancelDeletionUrl(cancelToken: string): string {
		const sep = this.#cancelDeletionUrlBase.includes("?") ? "&" : "?";
		return `${this.#cancelDeletionUrlBase}${sep}token=${encodeURIComponent(cancelToken)}`;
	}

	buildEmailChangeConfirmUrl(confirmToken: string): string {
		const sep = this.#emailChangeConfirmUrlBase.includes("?") ? "&" : "?";
		return `${this.#emailChangeConfirmUrlBase}${sep}token=${encodeURIComponent(confirmToken)}`;
	}

	/**
	 * `EmailService` si está cargado y sabe enviar (duck-typing, resuelto EN CADA USO porque el
	 * preset es recargable). Existe porque la confirmación de cambio de email va a una casilla que
	 * NO es la registrada, y el pipeline de notificaciones sólo entrega a la de la cuenta.
	 */
	getSystemEmailSender(): INotificationEmailSender | null {
		const svc = this.tryGetMyService<Partial<INotificationEmailSender>>("EmailService");
		if (svc && typeof svc.sendSystemEmail === "function") return svc as INotificationEmailSender;
		return null;
	}

	/**
	 * `EmailService` si además sabe renombrar buzones: la dirección de plataforma se deriva del
	 * username, así que cambiarlo arrastra la casilla. Sin el preset no hay casilla que arrastrar.
	 */
	getMailboxRenamer(): IMailboxRenamer | null {
		const svc = this.tryGetMyService<Partial<IMailboxRenamer>>("EmailService");
		if (svc && typeof svc.renameUserMailboxes === "function") return svc as IMailboxRenamer;
		return null;
	}

	/**
	 * `AuditLogService` resuelto EN CADA USO (opcional y recargable), `null` si no está cargado.
	 * Cada endpoint elige fail-closed (baja administrativa) o best-effort según el riesgo.
	 */
	getAuditWriter(): IAuditLogService | null {
		return this.tryGetMyService<IAuditLogService>("AuditLogService") ?? null;
	}

	/**
	 * Cascada de purga YA (variante `immediate` de la baja administrativa). No sirve para saltear
	 * la retención: el guard del stepper y el borrado condicional hacen no-op si la baja no está
	 * vigente. Un fallo queda logueado y el cron de 6h retoma desde el paso fallido.
	 */
	async purgeDueUserNow(userId: string): Promise<void> {
		try {
			await this.#purgeUserResumable(userId, this.#getUserDataPurgers());
		} catch (err: any) {
			this.logger.logWarn(`Purga inmediata de ${userId} incompleta (la retoma el cron): ${err?.message || err}`);
		}
	}

	/**
	 * Documento del export de datos personales (portabilidad, art. 14 Ley 25.326 / arts. 15 y 20
	 * RGPD): la sección de identidad se arma acá y el resto sale de `exportUserData(cap, userId)`
	 * en cada servicio — espejo del contrato de purga (`#getUserDataPurgers`), misma resolución
	 * perezosa y mismo handshake `identity:internal`. Una sección que falla se declara
	 * `available: false` en vez de abortar el export completo.
	 */
	async buildUserDataExport(userId: string): Promise<UserDataExportDocument> {
		const users = this.#internalUserManager;
		if (!users) throw new Error("IdentityManagerService no inicializado");
		const user = await users.getUser(userId);
		if (!user) throw new Error(`Usuario ${userId} no encontrado`);

		const { passwordHash: _passwordHash, ...safeUser } = user;
		// Material de autenticación, no un dato personal: nunca sale en el export (mismo helper que
		// usa la sanitización de las respuestas HTTP, para que haya una sola definición).
		const metadata = sanitizeUserMetadata(safeUser.metadata) ?? {};

		const sections: Record<string, UserDataExportSection> = {
			identity: {
				available: true,
				data: {
					profile: {
						id: safeUser.id,
						username: safeUser.username,
						email: safeUser.email ?? null,
						avatar: safeUser.avatar ?? null,
						isActive: safeUser.isActive,
						roleIds: safeUser.roleIds,
						groupIds: safeUser.groupIds,
						permissions: safeUser.permissions ?? [],
						orgMemberships: safeUser.orgMemberships ?? [],
						createdAt: safeUser.createdAt,
						updatedAt: safeUser.updatedAt,
						lastLogin: safeUser.lastLogin ?? null,
					},
					legalAcceptance: (metadata.legalAcceptance as Record<string, unknown> | undefined) ?? null,
					linkedAccounts: (safeUser.linkedAccounts ?? []).map((a) => ({
						provider: a.provider,
						providerId: a.providerId,
						providerUsername: a.providerUsername ?? null,
						providerAvatar: a.providerAvatar ?? null,
						status: a.status,
						linkedAt: a.linkedAt,
						unlinkedAt: a.unlinkedAt ?? null,
					})),
					metadata,
				},
				note: {
					es: "Perfil, constancia de aceptación legal, cuentas vinculadas (sin tokens de acceso) y metadata de la cuenta. La contraseña y su hash no se exportan nunca.",
					en: "Profile, legal acceptance record, linked accounts (without access tokens) and account metadata. The password and its hash are never exported.",
				},
			},
		};

		// Misma lista que la purga en cascada + SessionManagerService (sesiones activas), resuelta
		// fresca en cada export: apunta a la instancia vigente aunque el preset se haya recargado.
		const candidates: Array<{ service: string; section: string }> = [
			{ service: "SessionManagerService", section: "sessions" },
			{ service: "DriveService", section: "drive" },
			{ service: "EmailService", section: "email" },
			{ service: "ProjectManagerService", section: "projectManagement" },
			{ service: "NotificationService", section: "notifications" },
			{ service: "SubscriptionService", section: "subscription" },
			{ service: "content-service", section: "community" },
		];
		const notLoaded: BilingualNote = {
			es: "Servicio no disponible en este despliegue: no hay datos que exportar en esta sección.",
			en: "Service not available in this deployment: there is no data to export in this section.",
		};
		const failed: BilingualNote = {
			es: "Esta sección no pudo generarse en este intento; reintentá el export más tarde o contactá soporte.",
			en: "This section could not be generated this time; retry the export later or contact support.",
		};

		const cap = this.getCapability();
		for (const { service, section } of candidates) {
			const instance = this.tryGetMyService<Record<string, unknown>>(service);
			const fn = instance?.exportUserData;
			if (typeof fn !== "function") {
				sections[section] = { available: false, note: notLoaded };
				continue;
			}
			try {
				const data = await (fn as (cap: CapabilityToken, u: string) => Promise<unknown>).call(instance, cap, userId);
				sections[section] = { available: true, data };
			} catch (err: any) {
				this.logger.logWarn(`Export de datos: sección ${section} (${service}) falló para ${userId}: ${err?.message || err}`);
				sections[section] = { available: false, note: failed };
			}
		}

		return {
			format: "adc-user-data-export",
			formatVersion: USER_DATA_EXPORT_FORMAT_VERSION,
			generatedAt: new Date().toISOString(),
			userId: safeUser.id,
			username: safeUser.username,
			notes: {
				es:
					"Export de tus datos personales (art. 14 Ley 25.326 / arts. 15 y 20 RGPD) en JSON estructurado de lectura mecánica, una sección por servicio. " +
					"No incluye credenciales ni secretos (contraseñas y sus hashes, tokens, claves de cifrado) ni binarios (archivos de Drive, adjuntos de correo, avatar), " +
					"que se descargan desde cada app. Cada sección declara sus topes y qué quedó afuera.",
				en:
					"Export of your personal data (sec. 14 of Argentine Act 25.326 / arts. 15 & 20 GDPR) as machine-readable structured JSON, one section per service. " +
					"It excludes credentials and secrets (passwords and their hashes, tokens, encryption keys) and binaries (Drive files, mail attachments, avatar), " +
					"which can be downloaded from each app. Each section declares its caps and what was left out.",
			},
			sections,
		};
	}

	/**
	 * Lookup perezoso (y cacheado) de IModerationService.
	 * Usado por endpoints ban/unban para alimentar la ban-list sin
	 * acoplar la inicialización (IModerationService arranca DESPUÉS).
	 */
	tryGetModerationService(): IModerationService | null {
		// Resolución lazy en cada uso (lookup O(1) en el registry): ModerationService
		// carga DESPUÉS (kernelMode 65 > 60) y puede recargarse en caliente.
		return this.tryGetMyService<IModerationService>("ModerationService") ?? null;
	}

	/**
	 * Un purger por candidato de {@link USER_DATA_PURGER_CANDIDATES} + StorageQuotaService al final.
	 *
	 * FAIL-CLOSED: un candidato declarado en el `config.json` pero no cargado al correr su paso
	 * LANZA (el usuario sigue "due" y el cron reintenta cada 6h); sin esto, un preset caído durante
	 * la purga terminaba en hard delete con sus datos huérfanos para siempre. El único caso que se
	 * omite es el candidato NO declarado (despliegue que quitó el módulo).
	 */
	#getUserDataPurgers(): UserDataPurger[] {
		if (!this.#kernelKey) return []; // aún no iniciado
		// Reenvía la **capability** de Identity (scope `identity:internal`): el servicio de
		// datos (Drive/PM/Email) valida el scope y purga con SU PROPIO token interno. Así el
		// handshake ya no depende de una master key compartida entre módulos.
		const cap = this.getCapability();

		const declared = new Set<string>();
		for (const svc of (this.config?.services as Array<{ name?: string }> | undefined) ?? []) {
			if (svc?.name) declared.add(svc.name);
		}

		const purgers: UserDataPurger[] = USER_DATA_PURGER_CANDIDATES.map(({ service, method }) => ({
			name: service,
			run: async (userId: string) => {
				// Resolución fresca EN CADA paso: apunta a la instancia vigente tras una recarga.
				const instance = this.tryGetMyService<Record<string, unknown>>(service);
				const fn = instance?.[method];
				if (typeof fn !== "function") {
					if (!declared.has(service)) {
						this.logger.logDebug(`Retention purge: ${service} no declarado en este despliegue; paso omitido`);
						return;
					}
					throw new Error(`purger ${service} declarado pero no disponible: la purga de ${userId} espera a que vuelva`);
				}
				await (fn as (cap: CapabilityToken, u: string) => Promise<void>).call(instance, cap, userId);
			},
		}));

		// StorageQuotaService no puede declararse en config.json (ciclo: él declara a Identity), así
		// que va por el reader del kernel, con el mismo contrato y el mismo fail-closed. ÚLTIMO a
		// propósito: borra los contadores DESPUÉS de que los demás soltaron lo que miden.
		purgers.push({
			name: "StorageQuotaService",
			run: async (userId: string) => {
				const quota = this.#getStorageQuotaService();
				if (typeof quota?.purgeUserData !== "function") {
					throw new Error(`purger StorageQuotaService no disponible: la purga de ${userId} espera a que vuelva`);
				}
				await quota.purgeUserData(cap, userId);
			},
		});
		return purgers;
	}

	/**
	 * Purga usuarios con `metadata.scheduledDeletionAt <= now`.
	 *
	 * Cada usuario se procesa como un pipeline reanudable vía `IOperationsService.stepper`
	 * (estado en MongoDB, TTL 48h). Si el proceso cae a mitad de la cascada, en el
	 * siguiente tick del timer el usuario sigue "due" (aún no borrado) y el stepper
	 * salta los pasos ya completados, reanudando los siguientes. El borrado del
	 * registro de usuario es SIEMPRE el último paso para preservar esta propiedad.
	 *
	 * Nota de diseño: es una tarea de mantenimiento automática (no iniciada por el
	 * usuario), por eso vive en el timer de retención y NO en un endpoint HTTP ni en
	 * el JobManager (cuya cola está pensada para endpoints async). La resiliencia la
	 * aporta el stepper (Mongo) + la re-ejecución periódica, sin requerir RabbitMQ.
	 */
	/**
	 * Revierte grants de tier temporales vencidos (recompensas de bug bounty).
	 * Tarea de mantenimiento automática (como la retención): corre en su propio
	 * timer y a través del manager interno (sin token).
	 */
	async #runTierGrantRevert(): Promise<void> {
		const users = this.#internalUserManager;
		if (!users) return;
		const now = new Date();
		const processed = await forEachPage(
			(afterId, limit) => users.findUsersDueForTierRevertPage(afterId, limit, now),
			async (page) => {
				for (const { id } of page) {
					try {
						await users.revertExpiredTierGrant(id, now);
						this.permissions?.invalidateUser?.(id);
					} catch (err: any) {
						this.logger.logWarn(`Revertir tier grant falló para ${id} (se reintentará): ${err?.message || err}`);
					}
				}
			}
		);
		if (processed > 0) this.logger.logInfo(`Tier grants vencidos: ${processed} procesados`);
	}

	async #runRetentionPurge(): Promise<void> {
		const users = this.#internalUserManager;
		if (!users) return;
		const purgers = this.#getUserDataPurgers();
		const processed = await forEachPage(
			(afterId, limit) => users.findUsersDueForDeletionPage(afterId, limit),
			async (page) => {
				for (const { id } of page) {
					try {
						await this.#purgeUserResumable(id, purgers);
					} catch (err: any) {
						// El usuario sigue "due": se reintentará en el próximo tick desde el paso fallido.
						this.logger.logWarn(`Retention purge falló para ${id} (se reintentará): ${err?.message || err}`);
					}
				}
			}
		);
		if (processed > 0) this.logger.logInfo(`Retention purge: ${processed} usuarios procesados`);
	}

	/**
	 * Ejecuta la purga en cascada de un usuario como pipeline reanudable.
	 * Pasos (orden estable): [avatar custom, purgers de datos privados…, limpieza de
	 * moderación, constancia legal + borrado del registro de usuario]. El stepper
	 * salta los ya completados.
	 *
	 * Carrera con la cancelación: se re-verifica que la baja siga vigente al arrancar y en el paso
	 * final (el hard delete es además condicional a nivel de query). Si se cancela con la cascada
	 * ya corrida, la purga ABORTA antes del hard delete: la cuenta sobrevive, pero lo que los
	 * purgers ya borraron no se restaura (la solicitud de baja lo autorizó).
	 */
	async #purgeUserResumable(userId: string, purgers: UserDataPurger[]): Promise<void> {
		const internalUserManager = this.#internalUserManager;
		if (!internalUserManager) return;

		// La baja pudo cancelarse entre el listado de vencidos y esta corrida (o la anterior, si
		// ésta es una reanudación).
		const dueUser = await internalUserManager.findDueUser(userId);
		if (!dueUser) {
			this.logger.logInfo(`Retention purge: baja de ${userId} ya no vigente (cancelada/reactivada); se omite`);
			return;
		}

		const steps: Step[] = [
			// 0: avatar custom (docs + objetos S3), que el hard delete no borra: sin este paso el
			// adjunto queda huérfano en el bucket. Va ANTES de los purgers para que la liberación
			// de cuota preceda a la purga de contadores, y es fail-closed como ellos.
			async () => {
				const avatars = this.#avatarAttachmentsManager;
				if (!avatars || !this.#kernelKey) {
					throw new Error(`manager de avatares no disponible: la purga de ${userId} espera a que vuelva`);
				}
				const removed = await avatars.forceDeleteByOwner(this.#kernelKey, "user-avatar", userId);
				if (removed > 0) this.logger.logInfo(`Retention purge: ${removed} avatar(es) custom de ${userId} eliminados`);
			},
			// 1..N: purga de datos privados en cada servicio opcional (PM, email…).
			// Estos métodos ya son idempotentes en cascada, por lo que reejecutarlos es seguro.
			...purgers.map((purger) => async () => {
				await purger.run(userId);
			}),
			// N: limpieza de moderación (mejor esfuerzo, nunca corta el pipeline).
			async () => {
				try {
					const moderation = this.tryGetModerationService();
					if (moderation && this.#kernelKey)
						await moderation._internal(this.getCapability()).unbanByUserIdInternal(userId, "auto-retention-purge");
				} catch (e: any) {
					this.logger.logWarn(`Retention purge: limpieza moderación de ${userId}: ${e?.message || e}`);
				}
			},
			// N+1 (último): constancia legal anonimizada + hard delete CONDICIONAL. Hasta acá el
			// usuario sigue "due"; si la baja se canceló a mitad de cascada, el paso aborta.
			async () => {
				const user = await internalUserManager.findDueUser(userId);
				if (!user) {
					throw new Error(`baja de ${userId} cancelada a mitad de cascada: se preserva la cuenta (lo ya purgado no se restaura)`);
				}
				// La constancia va ANTES del borrado y su fallo corta el paso: no se borra un
				// usuario sin preservar la prueba de su consentimiento (defensa posterior).
				await this.#legalArchiver?.archiveForUser(user);
				const deleted = await internalUserManager.hardDeleteDueUser(userId);
				if (!deleted) {
					throw new Error(`baja de ${userId} cancelada durante el borrado: se preserva la cuenta`);
				}
			},
		];

		// Identidad del doc del stepper: el avance persistido es POSICIONAL, así que sólo puede
		// reanudarse sobre un pipeline idéntico. El hash de composición en el `cmd` invalida los
		// docs viejos si un deploy cambia la lista de pasos, y el `scheduledDeletionAt` en el `id`
		// evita que una baja NUEVA herede pasos "completados" de la anterior dentro del TTL de 48h.
		// Los docs huérfanos expiran solos.
		const composition = sha256Hex(["avatar", ...purgers.map((p) => p.name), "moderation", "legal-archive+hard-delete"].join("|")).slice(
			0,
			12
		);
		const scheduledAtRaw = (dueUser.metadata as Record<string, unknown> | undefined)?.scheduledDeletionAt;
		const scheduledAtMs = new Date(scheduledAtRaw as string | number | Date).getTime();
		const requestId = `${userId}.${Number.isFinite(scheduledAtMs) ? scheduledAtMs : 0}`;

		const failedStep = await this.#operationsService.stepper(0, `retention-purge#${composition}`, requestId, steps);
		if (failedStep !== null) {
			const err = new Error(`retention-purge falló en el paso ${failedStep} (${steps.length} pasos, composición ${composition})`);
			(err as any).failedStep = failedStep;
			throw err;
		}
	}
}
