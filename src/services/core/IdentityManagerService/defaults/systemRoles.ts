import { CRUDXAction } from "@common/types/Actions.ts";
import { RESOURCE_NAME, IdentityScopes } from "@common/types/identity/permissions.ts";
import { PMScopes, PM_RESOURCE_NAME } from "@common/types/project-manager/permissions.ts";
import { StorageScopes, STORAGE_RESOURCE_NAME } from "@common/types/storage/permissions.ts";
import { SecurityScopes, SECURITY_RESOURCE_NAME } from "@common/types/security/permissions.ts";
import { ModulesScopes, MODULES_RESOURCE_NAME } from "@common/types/modules/permissions.ts";
import { EmailScopes, EMAIL_RESOURCE_NAME } from "@common/types/email/permissions.ts";
import { BaseRole, RoleHierarchy } from "@common/types/identity/Role.ts";
import { COMMUNITY_SCOPES_BITS, isGlobalOnlyResource } from "@common/types/resources.ts";

export enum SystemRole {
	SYSTEM = "SYSTEM",
	ADMIN = "Admin",
	NETWORK_MANAGER = "Network Manager",
	SECURITY_MANAGER = "Security Manager",
	DATA_MANAGER = "Data Manager",
	APP_MANAGER = "App Manager",
	PROJECT_MANAGER = "Project Manager",
	USER = "User",
	// Community roles (Discord autoroles)
	DISCORD_VIP = "Discord VIP",
	DISCORD_NITRO_BOOSTER = "Discord Nitro Booster",
	DISCORD_PUBLISHER = "Discord Publisher",
	DISCORD_REVIEWER = "Discord Reviewer",
}

/**
 * Roles de gestión base. Todos los permisos referencian recursos REALES
 * (registrados en `@common/types/resources.ts` y chequeados por endpoints).
 *
 * Para seeding de organizaciones se derivan via `toOrgRole()`: los permisos de
 * recursos `globalOnly` (security, modules) se eliminan — sólo los roles
 * GLOBALES pueden portarlos (gestión de plataforma, no de una org).
 */
const BASE_MANAGEMENT_ROLES: Array<BaseRole> = [
	{
		name: SystemRole.ADMIN,
		description: "Administrador del sistema",
		hierarchy: RoleHierarchy.ADMIN,
		permissions: [{ resource: "*", action: CRUDXAction.ALL, scope: 0xffff }],
	},
	{
		name: SystemRole.NETWORK_MANAGER,
		description: "Gestor de infraestructura de red (regiones de despliegue)",
		hierarchy: RoleHierarchy.MANAGER,
		permissions: [{ resource: RESOURCE_NAME, action: CRUDXAction.CRUD, scope: IdentityScopes.REGIONS }],
	},
	{
		name: SystemRole.SECURITY_MANAGER,
		description: "Gestor de seguridad (identidad, sesiones, auditoría, moderación)",
		hierarchy: RoleHierarchy.MANAGER,
		permissions: [
			{ resource: RESOURCE_NAME, action: CRUDXAction.CRUD, scope: IdentityScopes.ALL },
			// Global-only: gestión de sesiones (force logout) + lectura del audit log.
			{ resource: SECURITY_RESOURCE_NAME, action: CRUDXAction.CRUD, scope: SecurityScopes.ALL },
		],
	},
	{
		name: SystemRole.DATA_MANAGER,
		description: "Gestor de datos (cuotas de storage, recuperación de Drive, correo)",
		hierarchy: RoleHierarchy.MANAGER,
		permissions: [
			{ resource: STORAGE_RESOURCE_NAME, action: CRUDXAction.CRUD, scope: StorageScopes.ALL },
			// Recuperación admin de archivos purgados / legal hold en Drive.
			{ resource: "drive", action: CRUDXAction.EXECUTE, scope: 1 },
			// Administración de cuentas y settings de correo (cuando EmailService esté activo).
			{ resource: EMAIL_RESOURCE_NAME, action: CRUDXAction.CRUD, scope: EmailScopes.ACCOUNTS | EmailScopes.SETTINGS },
		],
	},
	{
		name: SystemRole.APP_MANAGER,
		description: "Gestor de aplicaciones (modules-manager: runtime, git, avisos, schedules, audit)",
		hierarchy: RoleHierarchy.MANAGER,
		// Global-only: la gestión de módulos es de plataforma. ALL incluye EXECUTE
		// (start/stop/reload, git pull, anuncios broadcast).
		permissions: [{ resource: MODULES_RESOURCE_NAME, action: CRUDXAction.ALL, scope: ModulesScopes.ALL }],
	},
	{
		name: SystemRole.PROJECT_MANAGER,
		description: "Gestor de proyectos (CRUD completo sobre project-manager)",
		hierarchy: RoleHierarchy.MANAGER,
		permissions: [{ resource: PM_RESOURCE_NAME, action: CRUDXAction.CRUD, scope: PMScopes.ALL }],
	},
	{
		name: SystemRole.USER,
		description: "Usuario estándar del sistema",
		hierarchy: RoleHierarchy.MEMBER,
		permissions: [{ resource: RESOURCE_NAME, action: CRUDXAction.READ, scope: IdentityScopes.SELF }],
	},
];

/**
 * Deriva la variante de organización de un rol base: sin permisos de recursos
 * `globalOnly`. Devuelve `null` si el rol queda sin permisos (no se seedea en orgs).
 */
function toOrgRole(role: BaseRole): BaseRole | null {
	const permissions = role.permissions.filter((p) => !isGlobalOnlyResource(p.resource));
	if (permissions.length === 0) return null;
	return { ...role, permissions };
}

/** Roles seedeados por organización (App Manager queda excluido: sólo tiene permisos globalOnly). */
export const ORG_PREDEFINED_ROLES: Array<BaseRole> = BASE_MANAGEMENT_ROLES.map(toOrgRole).filter((r): r is BaseRole => r !== null);

/** Roles globales: SYSTEM + gestión completa (con permisos globalOnly) + community. */
export const PREDEFINED_ROLES: Array<BaseRole> = [
	{
		name: SystemRole.SYSTEM,
		description: "Usuario del sistema con acceso total",
		hierarchy: RoleHierarchy.SYSTEM,
		permissions: [{ resource: "*", action: CRUDXAction.ALL, scope: 0xffff }],
	},
	...BASE_MANAGEMENT_ROLES,
	// ─── Community roles (Discord autoroles) ─────────────────────────────────
	{
		name: SystemRole.DISCORD_VIP,
		description: "Miembro VIP de la comunidad Discord",
		hierarchy: RoleHierarchy.MEMBER,
		permissions: [{ resource: "community", action: CRUDXAction.RW, scope: COMMUNITY_SCOPES_BITS.SOCIAL }],
	},
	{
		name: SystemRole.DISCORD_NITRO_BOOSTER,
		description: "Nitro Booster del servidor de Discord",
		hierarchy: RoleHierarchy.MEMBER,
		permissions: [{ resource: "community", action: CRUDXAction.RW, scope: COMMUNITY_SCOPES_BITS.SOCIAL }],
	},
	{
		name: SystemRole.DISCORD_PUBLISHER,
		description: "Publicador de contenido de la comunidad",
		hierarchy: RoleHierarchy.MEMBER,
		permissions: [
			{ resource: "community", action: CRUDXAction.READ | CRUDXAction.WRITE | CRUDXAction.UPDATE, scope: COMMUNITY_SCOPES_BITS.CONTENT },
		],
	},
	{
		name: SystemRole.DISCORD_REVIEWER,
		description: "Revisor de contenido de la comunidad",
		hierarchy: RoleHierarchy.MEMBER,
		permissions: [
			{ resource: "community", action: CRUDXAction.CRUD, scope: COMMUNITY_SCOPES_BITS.CONTENT },
			{ resource: "community", action: CRUDXAction.CRUD, scope: COMMUNITY_SCOPES_BITS.PUBLISH_STATUS },
		],
	},
];
