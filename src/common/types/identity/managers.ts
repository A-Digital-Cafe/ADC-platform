/**
 * Contratos de los managers de identidad.
 *
 * Viven en `@common` porque la implementación es un preset opcional
 * (`presets/IAM/`): servicios y apps del núcleo, y presets de terceros, dependen de estas
 * interfaces y nunca de las clases concretas. Las clases del preset hacen `implements`, así que
 * cualquier divergencia de firma rompe el build.
 */

import type { Group } from "./Group.ts";
import type { LinkedAccount, User } from "./User.ts";
import type { Organization } from "./Organization.ts";
import type { Permission, ResolvedPermission } from "./Permission.ts";
import type { RegionInfo, RegionMetadata } from "./Region.ts";
import type { Role } from "./Role.ts";
import type { TwoFactorMethod, TwoFactorState } from "./TwoFactor.ts";
import type { AccountTier, TierGrant } from "../tiers.ts";
import type { CapabilityToken } from "../../security/Capability.ts";

/** Página de una lista administrativa: los ítems del tramo + el total sin paginar. */
export interface PagedResult<T> {
	items: T[];
	total: number;
}

/** Opciones de paginación/búsqueda de los listados administrativos. */
export interface ListOptions {
	limit?: number;
	offset?: number;
	q?: string;
	/** Campo de orden; cada DAO define su propia whitelist de campos aceptados. */
	sortBy?: string;
	sortDir?: "asc" | "desc";
}

/**
 * Resultado de `authenticate`. Las dos formas cortas distinguen "existe pero está inhabilitado"
 * de "la contraseña no coincide" sin devolver el usuario: quien todavía no probó su identidad no
 * recibe el documento.
 */
export type UserAuthenticationResult = Partial<User> | { id: string; isActive: boolean } | { id: string; wrongPassword: boolean } | null;

/** Alcance de una invalidación de la cache de permisos. */
export type PermissionInvalidation = { scope: "user"; userId: string } | { scope: "all" };

/** Secreto TOTP recién generado: se muestra una sola vez. */
export interface EnrollmentStart {
	secret: string;
	otpauthUri: string;
}

/**
 * Superficie pública del manager de usuarios: sin las primitivas pre-auth ni el hard delete,
 * que viven en {@link IUserManagerInternal}.
 */
export interface IUserManager {
	createUser(username: string, password: string, roleIds?: string[], token?: string): Promise<User>;
	getUser(userId: string, token?: string): Promise<User | null>;
	getPublicProfiles(userIds: readonly string[]): Promise<Map<string, { username?: string; avatar: string | null }>>;
	getUserByUsername(username: string, token?: string): Promise<User | null>;
	existUserByName(username: string): Promise<boolean>;
	getUserByEmail(email: string, token?: string): Promise<User | null>;
	findByProviderIdOrEmail(providerIdField: string, providerId: string, email?: string, token?: string): Promise<User | null>;
	findByLinkedExternalAccount(provider: string, providerId: string, token?: string): Promise<User | null>;
	linkExternalAccount(userId: string, account: LinkedAccount, token?: string): Promise<User>;
	unlinkExternalAccount(userId: string, provider: string, token?: string): Promise<User>;
	updateUser(userId: string, updates: Partial<User>, token?: string): Promise<User>;
	updateOwnMetadata(userId: string, partial: Record<string, unknown>, token?: string): Promise<User>;

	grantTemporaryTier(userId: string, tier: AccountTier, days: number, reason: string | undefined, token?: string): Promise<TierGrant>;
	findUsersDueForTierRevertPage(afterId: string | null, limit: number, now?: Date, token?: string): Promise<Array<{ id: string }>>;
	revertExpiredTierGrant(userId: string, now?: Date, token?: string): Promise<void>;

	updatePassword(userId: string, newPassword: string, token?: string): Promise<void>;
	requestEmailChange(userId: string, newEmail: string, token?: string): Promise<{ confirmToken: string; expiresAt: Date }>;
	markEmailChangeUnconfirmable(userId: string, newEmail: string): Promise<void>;
	confirmEmailChangeByToken(rawToken: string): Promise<{ user: User; previousEmail: string | null }>;
	changeOwnUsername(userId: string, newUsername: string, token?: string): Promise<User>;

	scheduleAdminDeletion(userId: string, retentionDays?: number, token?: string): Promise<User>;
	requestSelfDeletion(userId: string, note?: string, retentionDays?: number, token?: string): Promise<{ user: User; cancelToken: string | null }>;
	cancelScheduledDeletion(userId: string, token?: string): Promise<User>;
	cancelSelfDeletionByToken(rawToken: string): Promise<User>;
	findDueUser(userId: string, now?: Date, token?: string): Promise<User | null>;
	findUsersDueForDeletionPage(afterId: string | null, limit: number, now?: Date, token?: string): Promise<Array<{ id: string }>>;

	banUser(userId: string, args: { reason: string; expiresAt?: Date | null; retentionDays?: number }, token?: string): Promise<User>;
	unbanUser(userId: string, token?: string): Promise<User>;

	getAllUsers(token?: string, orgId?: string, opts?: ListOptions): Promise<PagedResult<User>>;
	getAllUserIds(token?: string): Promise<string[]>;
	countUsersByTier(token?: string): Promise<Record<string, number>>;
	getUserIdsPage(afterId: string | null, limit: number, token?: string): Promise<string[]>;
	searchUsers(query: string, limit?: number, token?: string, orgId?: string): Promise<User[]>;

	getAvatarAttachmentId(userId: string, token?: string): Promise<string | null>;
	findUsersWithRemoteAvatarPage(limit: number, token?: string): Promise<Array<{ id: string; remoteAvatarUrl?: string }>>;
	clearRemoteAvatarRefs(userId: string, attachmentId?: string | null, token?: string): Promise<void>;

	addOrgMembership(userId: string, orgId: string, roleIds?: string[], token?: string): Promise<User>;
	removeOrgMembership(userId: string, orgId: string, token?: string): Promise<User>;
	removeAllOrgMemberships(orgId: string, token?: string): Promise<void>;
	getUserOrganizations(userId: string, token?: string): Promise<string[]>;

	getUsersByRole(roleId: string, limit?: number, token?: string): Promise<string[]>;
	removeRoleFromAll(roleId: string, token?: string): Promise<void>;
	removeGroupFromAll(groupId: string, token?: string): Promise<void>;
	addToGroup(userId: string, groupId: string, token?: string): Promise<void>;
	removeFromGroup(userId: string, groupId: string, token?: string): Promise<void>;
	getUsersByGroup(groupId: string, token?: string, limit?: number): Promise<User[]>;
}

/**
 * Manager de usuarios completo. Suma las primitivas que corren **antes** de haber verificado la
 * identidad (login) y el hard delete del stepper de retención; sólo se alcanza tras el gate
 * `_internal` (scope `identity:internal`), nunca desde la superficie pública del servicio.
 */
export interface IUserManagerInternal extends IUserManager {
	authenticate(username: string, password: string): Promise<UserAuthenticationResult>;
	verifyUserPassword(userId: string, password: string): Promise<boolean>;
	/** Reactiva sin verificar nada: sólo la puede usar quien acaba de validar la identidad. */
	cancelSelfDeletionOnLogin(userId: string): Promise<User | null>;
	hardDeleteDueUser(userId: string, now?: Date, token?: string): Promise<boolean>;
}

export interface IRoleManager {
	initializePredefinedRoles(orgId?: string): Promise<boolean>;
	createRole(name: string, description: string, permissions?: Permission[], token?: string, orgId?: string, hierarchy?: number): Promise<Role>;
	getRole(roleId: string, token?: string): Promise<Role | null>;
	getRolesByIds(roleIds: string[], token?: string, orgId?: string): Promise<Role[]>;
	getRoleByName(name: string, token?: string): Promise<Role | null>;
	updateRole(roleId: string, updates: Partial<Role>, token?: string): Promise<Role>;
	deleteRole(roleId: string, token?: string, resumeFromStep?: number): Promise<void>;
	deleteAllForOrg(orgId: string, token?: string): Promise<void>;
	getAllRoles(token?: string, orgId?: string, opts?: ListOptions & { ownOnly?: boolean }): Promise<PagedResult<Role>>;
	getPredefinedRoles(token?: string): Promise<Role[]>;
}

export interface IGroupManager {
	createGroup(name: string, description: string, roleIds?: string[], token?: string, orgId?: string): Promise<Group>;
	getGroup(groupId: string, token?: string): Promise<Group | null>;
	getPublicProfiles(groupIds: readonly string[]): Promise<Map<string, { name: string; description?: string }>>;
	updateGroup(groupId: string, updates: Partial<Group>, token?: string): Promise<Group>;
	deleteGroup(groupId: string, token?: string): Promise<void>;
	deleteAllForOrg(orgId: string, token?: string): Promise<void>;
	getAllGroups(token?: string, orgId?: string, opts?: ListOptions): Promise<PagedResult<Group>>;
	searchGroups(query: string, limit?: number, token?: string, orgId?: string): Promise<Group[]>;
	addUserToGroup(userId: string, groupId: string, token?: string): Promise<void>;
	removeUserFromGroup(userId: string, groupId: string, token?: string): Promise<void>;
	getGroupUsers(groupId: string, token?: string): Promise<User[]>;
	removeRoleFromAll(roleId: string, token?: string): Promise<void>;
}

export interface ISystemManager {
	initializeSystemUser(): Promise<void>;
	/** Gateado por capability con scope `identity:system`. */
	getSystemUser(token: CapabilityToken): Promise<User>;
	/** Credenciales válidas sólo durante este arranque. Scope `identity:system`. */
	getSystemCredentials(token: CapabilityToken): { username: string; password: string };
	clearSystemUser(kernelKey: symbol): void;
	getStats(): Promise<{ totalUsers: number; totalRoles: number; totalGroups: number; systemUserExists: boolean }>;
}

export interface IOrgManager {
	createOrganization(slug: string, region?: string, metadata?: Record<string, any>, token?: string): Promise<Organization>;
	getOrganization(orgIdOrSlug: string, token?: string): Promise<Organization | null>;
	resolveOrganizationSlug(orgIdOrSlug: string, token?: string): Promise<{ orgId: string; slug: string } | null>;
	updateOrganization(orgId: string, updates: Partial<Organization>, token?: string): Promise<Organization>;
	deleteOrganization(orgId: string, token?: string, resumeFromStep?: number): Promise<void>;
	getAllOrganizations(token?: string, limit?: number): Promise<Organization[]>;
	countOrganizations(token?: string): Promise<number>;
	countOrganizationsByTier(token?: string): Promise<Record<string, number>>;
	getOrganizationsByRegion(region: string, token?: string, limit?: number): Promise<Organization[]>;
	getDbName(org: Organization): string;
}

export interface IRegionManager {
	initialize(): Promise<void>;
	reload(): Promise<void>;
	createRegion(path: string, metadata: RegionMetadata, isGlobal?: boolean, token?: string): Promise<RegionInfo>;
	getRegion(path: string, token?: string): Promise<RegionInfo | null>;
	getGlobalRegion(token?: string): Promise<RegionInfo>;
	updateRegion(path: string, updates: Partial<RegionInfo>, token?: string): Promise<RegionInfo>;
	deleteRegion(path: string, token?: string): Promise<void>;
	getAllRegions(token?: string): Promise<RegionInfo[]>;
	getObjectConnectionUri(path: string): string | null;
}

export interface IPermissionManager {
	hasPermission(userId: string, action: number, scope: number, orgId?: string, resource?: string, opts?: { ownerId?: string }): Promise<boolean>;
	resolvePermissions(userId: string, orgId?: string): Promise<ResolvedPermission[]>;
	/** Nombres de los roles vigentes del usuario en el contexto (mismos criterios que `resolvePermissions`). */
	resolveRoleNames(userId: string, orgId?: string): Promise<string[]>;
	/** Nombres distintos de todos los roles existentes. Sólo para validar configuración. */
	listAllRoleNames(): Promise<string[]>;
	getMaxHierarchy(userId: string, orgId?: string): Promise<number>;
	getRolesMaxHierarchy(roleIds: readonly string[]): Promise<number>;
	invalidateUser(userId: string): void;
	invalidateGroup(groupId: string): void;
	invalidateRole(roleId: string): void;
	invalidateAll(): void;
	/** Aplica la invalidación **sólo en este proceso**: re-difundirla arma un bucle entre nodos. */
	applyInvalidation(invalidation: PermissionInvalidation): void;
}

export interface ITwoFactorManager {
	isEnabled(userId: string): Promise<boolean>;
	getState(userId: string, required: boolean): Promise<TwoFactorState>;
	startEnrollment(userId: string, accountLabel: string): Promise<EnrollmentStart>;
	confirmEnrollment(userId: string, code: string): Promise<string[]>;
	verify(userId: string, code: string): Promise<TwoFactorMethod | null>;
	disable(userId: string): Promise<void>;
	regenerateRecoveryCodes(userId: string): Promise<string[]>;
}
