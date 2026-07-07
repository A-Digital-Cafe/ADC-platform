export { IdentityScopes as Scope } from "@common/types/identity/permissions.ts";

import { IdentityScopes } from "@common/types/identity/permissions.ts";
import { StorageScopes, STORAGE_RESOURCE_NAME } from "@common/types/storage/permissions.ts";
import type { Permission } from "@common/types/identity/Permission.js";
import { CRUDXAction } from "@common/types/Actions";
import { hasPermission } from "@common/utils/perms.ts";

/**
 * Tab definition for the identity management panel
 */
export interface IdentityTab {
	id: string;
	label: string;
	requiredScope: number;
	requiredAction: number;
	/** Resource del permiso requerido (default: "identity"). */
	resource?: string;
}

/**
 * Available tabs with their required permissions
 */
const IDENTITY_TABS: IdentityTab[] = [
	{ id: "users", label: "users", requiredScope: IdentityScopes.USERS, requiredAction: CRUDXAction.READ },
	{ id: "roles", label: "roles", requiredScope: IdentityScopes.ROLES, requiredAction: CRUDXAction.READ },
	{ id: "groups", label: "groups", requiredScope: IdentityScopes.GROUPS, requiredAction: CRUDXAction.READ },
	{ id: "organizations", label: "organizations", requiredScope: IdentityScopes.ORGANIZATIONS, requiredAction: CRUDXAction.READ },
	{ id: "regions", label: "regions", requiredScope: IdentityScopes.REGIONS, requiredAction: CRUDXAction.READ },
	// Moderación (bans): el backend exige admin global + identity.users UPDATE.
	{ id: "moderation", label: "moderation", requiredScope: IdentityScopes.USERS, requiredAction: CRUDXAction.UPDATE },
	{ id: "storage", label: "storage", requiredScope: StorageScopes.LIMITS, requiredAction: CRUDXAction.READ, resource: STORAGE_RESOURCE_NAME },
];

const RESOURCE = "identity";

/** Tabs de plataforma: sólo visibles en contexto global (sin org). */
const GLOBAL_ONLY_TABS = new Set(["organizations", "regions", "moderation"]);

/**
 * Filters tabs based on user's permissions.
 * When orgId is set (org mode), platform-level tabs are hidden.
 */
export function getVisibleTabs(perms: Permission[], orgId?: string): IdentityTab[] {
	return IDENTITY_TABS.filter((tab) => {
		if (orgId && GLOBAL_ONLY_TABS.has(tab.id)) return false;
		return hasPermission(perms, tab.resource ?? RESOURCE, tab.requiredAction, tab.requiredScope);
	});
}

/**
 * Checks if user can perform a specific action on a scope
 */
export function canWrite(perms: Permission[], scope: number): boolean {
	return hasPermission(perms, RESOURCE, CRUDXAction.WRITE, scope);
}

export function canUpdate(perms: Permission[], scope: number): boolean {
	return hasPermission(perms, RESOURCE, CRUDXAction.UPDATE, scope);
}

export function canDelete(perms: Permission[], scope: number): boolean {
	return hasPermission(perms, RESOURCE, CRUDXAction.DELETE, scope);
}
