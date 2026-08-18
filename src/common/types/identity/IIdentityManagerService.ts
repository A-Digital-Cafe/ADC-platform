/**
 * Contrato público del **IdentityManagerService** (clase principal).
 *
 * Vive en `@common` para que servicios, apps y presets consuman Identity por
 * **interfaz** (sin importar la clase concreta del preset `IAM`). La clase concreta
 * hace `implements IIdentityManagerService`: cualquier divergencia de firma rompe
 * el build.
 *
 * Los managers se contratan en [`managers.ts`](./managers.ts); acá van sólo la clase del
 * servicio y las superficies gateadas que devuelve.
 */

import type {
	IGroupManager,
	IOrgManager,
	IPermissionManager,
	IRegionManager,
	IRoleManager,
	ISystemManager,
	ITwoFactorManager,
	IUserManager,
	IUserManagerInternal,
} from "./managers.ts";
import type { Organization } from "./Organization.ts";
import type { IAuthVerifier } from "../auth-verifier.ts";
import type { CapabilityToken } from "../../security/Capability.ts";

/** Estadísticas del sistema de identidad. */
export interface IdentityStats {
	totalUsers: number;
	totalRoles: number;
	totalGroups: number;
	systemUserExists: boolean;
	totalOrganizations: number;
	totalRegions: number;
}

/** Managers con scope de organización (cada organización vive en su propia base). */
export interface OrgScopedManagers {
	org: Organization;
	users: IUserManager;
	roles: IRoleManager;
	groups: IGroupManager;
	initialize(): Promise<void>;
}

/**
 * Vincula (o no) una dirección a una cuenta **sin revelar si ya existía**. Nunca lanza: quien la
 * llama ya respondió lo mismo pase lo que pase, y una excepción sería, ella misma, el oráculo.
 */
export type EmailBinder = (userId: string, email: string, mode: "signup" | "change") => Promise<void>;

/**
 * Superficies internas de Identity, **separadas por scope** para least-privilege. Cada una se
 * obtiene por un método gateado distinto (`_internal`/`_internalAvatar`/`_internalDiscord`); un
 * consumidor declara sólo el/los scope(s) que usa.
 */

/** Managers de users/orgs/roles (scope `identity:internal`). */
export interface IdentityInternalApi {
	users: IUserManagerInternal;
	organizations: IOrgManager;
	roles: IRoleManager;
	/** Alta/verificación/baja del segundo factor. La usa el login, que corre sin sesión todavía. */
	twoFactor: ITwoFactorManager;
	getUserIdsByRoleName(roleName: string): Promise<string[]>;
	/**
	 * True si la cuenta es Admin **global** o Admin en **alguna** de sus organizaciones.
	 *
	 * Es el criterio único de "a esta cuenta el segundo factor le es obligatorio", y por eso mira
	 * todas las membresías en vez de la organización activa: si dependiera del contexto elegido en
	 * el login, un admin de organización se saltearía la exigencia entrando como acceso personal.
	 */
	isAdminAccount(userId: string): Promise<boolean>;
	/**
	 * Trae a nuestro almacenamiento el avatar que trae una cuenta OAuth y deja apuntada una URL
	 * propia. Best-effort: nunca lanza. Lo que NO puede pasar es que la URL del proveedor quede
	 * guardada —la pediría el navegador de cada visitante—, así que un fallo deja la cuenta sin
	 * avatar.
	 */
	ingestProviderAvatar(userId: string, remoteAvatarUrl?: string): Promise<void>;
	/** Escribe el email de un usuario arbitrario; por eso vive tras el gate. */
	bindEmailNeutrally: EmailBinder;
}

/**
 * Superficie de avatares (scope `identity:avatar`): sólo agregación de uso para cuota,
 * pre-ligada al token de Identity (el consumidor —StorageQuota— no cruza key alguna).
 */
export interface IdentityAvatarApi {
	avatarAttachments: {
		aggregateUsageByUser(): Promise<Array<{ userId: string; orgId: string | null; bytes: number; count: number }>>;
	} | null;
}

/** Mapeo de roles Discord (scope `identity:discord`). */
export interface IdentityDiscordApi {
	discordGuildId: string | undefined;
	getDiscordRoleMap(guildId: string): Promise<Record<string, string> | null>;
}

/**
 * Superficie combinada internal + discord, para consumidores que necesitan ambos
 * (p.ej. el sync de roles Discord de SessionManager). Requiere declarar `identity:internal`
 * **e** `identity:discord`.
 */
export type IdentityInternalWithDiscord = IdentityInternalApi & IdentityDiscordApi;

/**
 * Notificaciones de dominio de identidad/seguridad (gate `identity:internal`). Los topics
 * `security.*` son reservados y derivan su origen de la capability, no del payload.
 */
export interface IIdentityNotifyManager {
	setSecurityRecipientsResolver(resolver: () => Promise<string[]>): void;
	passwordChanged(userId: string): Promise<void>;
	twoFactorEnabled(userId: string): Promise<void>;
	twoFactorDisabled(userId: string, opts?: { byAdmin?: boolean }): Promise<void>;
	emailChangeRequested(userId: string, opts: { maskedNewEmail: string }): Promise<void>;
	emailChanged(userId: string): Promise<void>;
	usernameChanged(userId: string, opts?: { mailboxRenamed?: boolean }): Promise<void>;
	accountDeletionScheduled(userId: string, opts: { scheduledFor?: Date | string | null; cancelUrl?: string | null; byAdmin?: boolean }): Promise<void>;
	accountDeletionCancelled(userId: string): Promise<void>;
	securityEvent(event: { title: string; body: string; actorId?: string; data?: Record<string, unknown> }): Promise<void>;
	moduleFailure(event: { module: string; error: string }): Promise<void>;
	moduleDetected(event: { module: string; layer: string; filePath: string; preset: string | null }): Promise<void>;
	modulePrivilegesChanged(event: { module: string; layer: string; filePath: string; added: string[]; withheld: string[] }): Promise<void>;
	legalDocsUpdated(event: { changed: string[]; termsVersion: string; privacyVersion: string }): Promise<void>;
	integrityFailure(event: { checkId: string; title: string; nodeId: string; detail: string }): Promise<void>;
}

/**
 * Interfaz pública del IdentityManagerService. Los getters de managers exponen la superficie
 * pública (sin primitivas pre-auth); las superficies `_internal*` están gateadas por scope y
 * devuelven vistas acotadas.
 */
export interface IIdentityManagerService {
	readonly name: string;

	readonly users: IUserManager;
	readonly roles: IRoleManager;
	readonly groups: IGroupManager;
	readonly system: ISystemManager;
	readonly organizations: IOrgManager;
	readonly regions: IRegionManager;
	readonly permissions: IPermissionManager;

	createAuthVerifier(): IAuthVerifier;
	getStats(token?: string): Promise<IdentityStats>;
	forOrg(orgIdOrSlug: string, mode?: "read" | "write", token?: string): Promise<OrgScopedManagers>;

	_internal(token: CapabilityToken): IdentityInternalApi;
	_internalAvatar(token: CapabilityToken): IdentityAvatarApi;
	_internalDiscord(token: CapabilityToken): IdentityDiscordApi;
	notifications(token: CapabilityToken): IIdentityNotifyManager;
}
