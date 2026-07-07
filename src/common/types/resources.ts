import { SecurityScopes } from "./security/permissions.js";
import { ModulesScopes } from "./modules/permissions.js";
import { EmailScopes } from "./email/permissions.js";

// ─────────────────────────────────────────────────────────────────────────────
// Scope definition
// ─────────────────────────────────────────────────────────────────────────────

export interface ScopeDef {
	/** Unique key (used for i18n: `permissions.{key}`) */
	key: string;
	/** Bitfield value */
	value: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Resource definition
// ─────────────────────────────────────────────────────────────────────────────

export interface ResourceDef {
	/** Resource identifier (matches Permission.resource) */
	id: string;
	/** i18n label key: `resources.{id}` */
	label: string;
	/** Named scopes (bitfield). */
	scopes: ScopeDef[];
	/**
	 * Recurso de **plataforma**: sus permisos sólo son efectivos cuando provienen
	 * de un **rol global** (orgId nulo). `PermissionManager` los descarta de roles
	 * de organización, permisos directos de usuario, grupos y orgs; la UI de roles
	 * no los ofrece al editar roles de una organización.
	 */
	globalOnly?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scope presets
// ─────────────────────────────────────────────────────────────────────────────

/** Identity-specific scopes (matches IdentityScope from identity.ts) */
const IDENTITY_SCOPES: ScopeDef[] = [
	{ key: "self", value: 1 },
	{ key: "users", value: 1 << 1 },
	{ key: "roles", value: 1 << 2 },
	{ key: "groups", value: 1 << 3 },
	{ key: "organizations", value: 1 << 4 },
	{ key: "regions", value: 1 << 5 },
	{ key: "stats", value: 1 << 6 },
];

/** Community-specific scopes (Discord autoroles) - alineados con CommunityScopes en systemRoles.ts */
export const COMMUNITY_SCOPES_BITS = {
	CONTENT: 1,
	PUBLISH_STATUS: 1 << 1,
	SOCIAL: 1 << 2,
	COMMENTS: 1 << 3,
	ATTACHMENTS: 1 << 4,
} as const;

const COMMUNITY_SCOPES: ScopeDef[] = [
	{ key: "content", value: COMMUNITY_SCOPES_BITS.CONTENT },
	{ key: "publish_status", value: COMMUNITY_SCOPES_BITS.PUBLISH_STATUS },
	{ key: "social", value: COMMUNITY_SCOPES_BITS.SOCIAL },
	{ key: "comments", value: COMMUNITY_SCOPES_BITS.COMMENTS },
	{ key: "attachments", value: COMMUNITY_SCOPES_BITS.ATTACHMENTS },
];

/** Storage scopes — alineados con StorageScopes en types/storage/permissions.ts */
const STORAGE_SCOPES: ScopeDef[] = [
	{ key: "usage", value: 1 },
	{ key: "limits", value: 1 << 1 },
];

/** Drive scopes — `recover` habilita la recuperación admin de "eliminados permanentemente". */
const DRIVE_SCOPES: ScopeDef[] = [
	{ key: "recover", value: 1 },
];

/** Project Manager scopes — alineados con PMScopes en types/project-manager/permissions.ts */
const PROJECT_MANAGER_SCOPES: ScopeDef[] = [
	{ key: "projects", value: 1 },
	{ key: "issues", value: 1 << 1 },
	{ key: "sprints", value: 1 << 2 },
	{ key: "milestones", value: 1 << 3 },
	{ key: "custom_fields", value: 1 << 5 },
	{ key: "attachments", value: 1 << 6 },
	{ key: "settings", value: 1 << 7 },
	{ key: "stats", value: 1 << 8 },
	{ key: "comments", value: 1 << 9 },
];

/** Security scopes — alineados con SecurityScopes en types/security/permissions.ts */
const SECURITY_SCOPES: ScopeDef[] = [
	{ key: "sessions", value: SecurityScopes.SESSIONS },
	{ key: "audit", value: SecurityScopes.AUDIT },
];

/** Modules scopes — alineados con ModulesScopes en types/modules/permissions.ts */
const MODULES_SCOPES: ScopeDef[] = [
	{ key: "runtime", value: ModulesScopes.RUNTIME },
	{ key: "git", value: ModulesScopes.GIT },
	{ key: "banners", value: ModulesScopes.BANNERS },
	{ key: "schedule", value: ModulesScopes.SCHEDULE },
	{ key: "audit", value: ModulesScopes.AUDIT },
];

/** Email scopes — alineados con EmailScopes en types/email/permissions.ts (sin el bit SELF, que es modificador) */
const EMAIL_SCOPES: ScopeDef[] = [
	{ key: "messages", value: EmailScopes.MESSAGES },
	{ key: "send", value: EmailScopes.SEND },
	{ key: "drafts", value: EmailScopes.DRAFTS },
	{ key: "attachments", value: EmailScopes.ATTACHMENTS },
	{ key: "accounts", value: EmailScopes.ACCOUNTS },
	{ key: "settings", value: EmailScopes.SETTINGS },
];

// ─────────────────────────────────────────────────────────────────────────────
// Resource registry — only resources that have real endpoints
// ─────────────────────────────────────────────────────────────────────────────

export const RESOURCES: ResourceDef[] = [
	{ id: "identity", label: "resources.identity", scopes: IDENTITY_SCOPES },
	{ id: "storage", label: "resources.storage", scopes: STORAGE_SCOPES },
	{ id: "drive", label: "resources.drive", scopes: DRIVE_SCOPES },
	{ id: "community", label: "resources.community", scopes: COMMUNITY_SCOPES },
	{ id: "project-manager", label: "resources.project-manager", scopes: PROJECT_MANAGER_SCOPES },
	{ id: "email", label: "resources.email", scopes: EMAIL_SCOPES },
	{ id: "security", label: "resources.security", scopes: SECURITY_SCOPES, globalOnly: true },
	{ id: "modules", label: "resources.modules", scopes: MODULES_SCOPES, globalOnly: true },
];

/**
 * Lookup by resource id
 * @public
 */
export const RESOURCE_MAP: ReadonlyMap<string, ResourceDef> = new Map(RESOURCES.map((r) => [r.id, r]));

/**
 * Get scopes for a resource (falls back to empty)
 * @public
 */
export function getResourceScopes(resourceId: string): ScopeDef[] {
	return RESOURCE_MAP.get(resourceId)?.scopes ?? [];
}

/**
 * True si el recurso es de plataforma (`globalOnly`): sus permisos sólo valen
 * desde roles globales.
 * @public
 */
export function isGlobalOnlyResource(resourceId: string): boolean {
	return RESOURCE_MAP.get(resourceId)?.globalOnly === true;
}
