import { CRUDXAction } from "@common/types/Actions.ts";
import { RESOURCE_NAME, IdentityScopes } from "@common/types/identity/permissions.ts";
import { PMScopes, PM_RESOURCE_NAME } from "@common/types/project-manager/permissions.ts";
import { StorageScopes, STORAGE_RESOURCE_NAME } from "@common/types/storage/permissions.ts";
import { BaseRole } from "@common/types/identity/Role.ts";
import { COMMUNITY_SCOPES_BITS } from "@common/types/resources.ts";

export enum SystemRole {
	SYSTEM = "SYSTEM",
	ADMIN = "Admin",
	NETWORK_MANAGER = "Network Manager",
	SECURITY_MANAGER = "Security Manager",
	DATA_MANAGER = "Data Manager",
	APP_MANAGER = "App Manager",
	CONFIG_MANAGER = "Config Manager",
	PROJECT_MANAGER = "Project Manager",
	USER = "User",
	// Community roles (Discord autoroles)
	DISCORD_VIP = "Discord VIP",
	DISCORD_NITRO_BOOSTER = "Discord Nitro Booster",
	DISCORD_PUBLISHER = "Discord Publisher",
	DISCORD_REVIEWER = "Discord Reviewer",
}

export const ORG_PREDEFINED_ROLES: Array<BaseRole> = [
	{
		name: SystemRole.ADMIN,
		description: "Administrador del sistema",
		permissions: [{ resource: "*", action: CRUDXAction.ALL, scope: 0xffff }],
	},
	{
		name: SystemRole.NETWORK_MANAGER,
		description: "Gestor de redes",
		permissions: [
			{ resource: "network", action: CRUDXAction.CRUD, scope: 0xff },
			{ resource: "devices", action: CRUDXAction.READ, scope: 0xff },
		],
	},
	{
		name: SystemRole.SECURITY_MANAGER,
		description: "Gestor de seguridad",
		permissions: [
			{ resource: "identity", action: CRUDXAction.CRUD, scope: IdentityScopes.ALL },
			{ resource: "security", action: CRUDXAction.CRUD, scope: 0xff },
			{ resource: "audit", action: CRUDXAction.READ, scope: 0xff },
		],
	},
	{
		name: SystemRole.DATA_MANAGER,
		description: "Gestor de datos",
		permissions: [
			{ resource: "data", action: CRUDXAction.CRUD, scope: 0xff },
			{ resource: "database", action: CRUDXAction.CRUD, scope: 0xff },
			{ resource: STORAGE_RESOURCE_NAME, action: CRUDXAction.CRUD, scope: StorageScopes.ALL },
		],
	},
	{
		name: SystemRole.APP_MANAGER,
		description: "Gestor de aplicaciones",
		permissions: [
			{ resource: "apps", action: CRUDXAction.CRUD, scope: 0xff },
			// modules: incluye EXECUTE (16) para iniciar/detener/recargar vía el modules-manager.
			{ resource: "modules", action: CRUDXAction.ALL, scope: 0xff },
		],
	},
	{
		name: SystemRole.CONFIG_MANAGER,
		description: "Gestor de configuración",
		permissions: [
			{ resource: "config", action: CRUDXAction.CRUD, scope: 0xff },
			{ resource: "system", action: CRUDXAction.READ, scope: 0xff },
		],
	},
	{
		name: SystemRole.PROJECT_MANAGER,
		description: "Gestor de proyectos (CRUD completo sobre project-manager)",
		permissions: [{ resource: PM_RESOURCE_NAME, action: CRUDXAction.CRUD, scope: PMScopes.ALL }],
	},
	{
		name: SystemRole.USER,
		description: "Usuario estándar del sistema",
		permissions: [{ resource: RESOURCE_NAME, action: CRUDXAction.READ, scope: IdentityScopes.SELF }],
	},
];

export const PREDEFINED_ROLES: Array<BaseRole> = [
	{
		name: SystemRole.SYSTEM,
		description: "Usuario del sistema con acceso total",
		permissions: [{ resource: "*", action: CRUDXAction.ALL, scope: 0xffff }],
	},
	...ORG_PREDEFINED_ROLES,
	// ─── Community roles (Discord autoroles) ─────────────────────────────────
	{
		name: SystemRole.DISCORD_VIP,
		description: "Miembro VIP de la comunidad Discord",
		permissions: [{ resource: "community", action: CRUDXAction.RW, scope: COMMUNITY_SCOPES_BITS.SOCIAL }],
	},
	{
		name: SystemRole.DISCORD_NITRO_BOOSTER,
		description: "Nitro Booster del servidor de Discord",
		permissions: [{ resource: "community", action: CRUDXAction.RW, scope: COMMUNITY_SCOPES_BITS.SOCIAL }],
	},
	{
		name: SystemRole.DISCORD_PUBLISHER,
		description: "Publicador de contenido de la comunidad",
		permissions: [
			{ resource: "community", action: CRUDXAction.READ | CRUDXAction.WRITE | CRUDXAction.UPDATE, scope: COMMUNITY_SCOPES_BITS.CONTENT },
		],
	},
	{
		name: SystemRole.DISCORD_REVIEWER,
		description: "Revisor de contenido de la comunidad",
		permissions: [
			{ resource: "community", action: CRUDXAction.CRUD, scope: COMMUNITY_SCOPES_BITS.CONTENT },
			{ resource: "community", action: CRUDXAction.CRUD, scope: COMMUNITY_SCOPES_BITS.PUBLISH_STATUS },
		],
	},
];
