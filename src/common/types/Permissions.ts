import { CRUDXAction } from "./Actions.js";
import { RESOURCES, type ResourceDef, type ScopeDef } from "./resources.js";

// ─────────────────────────────────────────────────────────────────────────────
// Typed permission builder
// ─────────────────────────────────────────────────────────────────────────────

type ScopePermissions<R extends string> = {
	readonly READ: `${R}.${number}.${typeof CRUDXAction.READ}`;
	readonly WRITE: `${R}.${number}.${typeof CRUDXAction.WRITE}`;
	readonly UPDATE: `${R}.${number}.${typeof CRUDXAction.UPDATE}`;
	readonly DELETE: `${R}.${number}.${typeof CRUDXAction.DELETE}`;
	readonly EXECUTE: `${R}.${number}.${typeof CRUDXAction.EXECUTE}`;
	readonly CRUD: `${R}.${number}.${typeof CRUDXAction.CRUD}`;
	readonly ALL: `${R}.${number}.${typeof CRUDXAction.ALL}`;
};

type SimplePermissions<R extends string> = {
	readonly READ: `${R}.read`;
	readonly WRITE: `${R}.write`;
	readonly UPDATE: `${R}.update`;
	readonly DELETE: `${R}.delete`;
	readonly EXECUTE: `${R}.execute`;
};

function buildScopePermissions<R extends string>(resource: R, scope: ScopeDef): ScopePermissions<R> {
	return {
		READ: `${resource}.${scope.value}.${CRUDXAction.READ}`,
		WRITE: `${resource}.${scope.value}.${CRUDXAction.WRITE}`,
		UPDATE: `${resource}.${scope.value}.${CRUDXAction.UPDATE}`,
		DELETE: `${resource}.${scope.value}.${CRUDXAction.DELETE}`,
		EXECUTE: `${resource}.${scope.value}.${CRUDXAction.EXECUTE}`,
		CRUD: `${resource}.${scope.value}.${CRUDXAction.CRUD}`,
		ALL: `${resource}.${scope.value}.${CRUDXAction.ALL}`,
	} as ScopePermissions<R>;
}

function buildSimplePermissions<R extends string>(resource: R): SimplePermissions<R> {
	return {
		READ: `${resource}.read`,
		WRITE: `${resource}.write`,
		UPDATE: `${resource}.update`,
		DELETE: `${resource}.delete`,
		EXECUTE: `${resource}.execute`,
	} as SimplePermissions<R>;
}

function buildResourcePermissions(resource: ResourceDef) {
	if (resource.simple) return buildSimplePermissions(resource.id);

	const result: Record<string, ScopePermissions<string>> = {};
	for (const scope of resource.scopes) {
		result[scope.key.toUpperCase()] = buildScopePermissions(resource.id, scope);
	}
	return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Generated permission constants
// ─────────────────────────────────────────────────────────────────────────────

function buildAllPermissions() {
	const result: Record<string, ReturnType<typeof buildResourcePermissions>> = {};
	for (const resource of RESOURCES) {
		// `project-manager` → `PROJECT_MANAGER` (JS-identifier-friendly property access)
		const key = resource.id.replaceAll("-", "_").toUpperCase();
		result[key] = buildResourcePermissions(resource);
	}
	return result;
}

/**
 * Typed permission constants generated from RESOURCES and CRUDXAction.
 *
 * Scoped resources (e.g. identity):
 *   `P.IDENTITY.USERS.READ`  → `"identity.2.1"`
 *   `P.IDENTITY.ROLES.WRITE` → `"identity.4.2"`
 *
 * Simple resources (e.g. content):
 *   `P.CONTENT.WRITE`  → `"content.write"`
 *   `P.CONTENT.DELETE` → `"content.delete"`
 */
export const P = buildAllPermissions() as {
	readonly IDENTITY: {
		readonly SELF: ScopePermissions<"identity">;
		readonly USERS: ScopePermissions<"identity">;
		readonly ROLES: ScopePermissions<"identity">;
		readonly GROUPS: ScopePermissions<"identity">;
		readonly ORGANIZATIONS: ScopePermissions<"identity">;
		readonly REGIONS: ScopePermissions<"identity">;
		readonly STATS: ScopePermissions<"identity">;
	};
	readonly COMMUNITY: {
		readonly CONTENT: ScopePermissions<"community">;
		readonly PUBLISH_STATUS: ScopePermissions<"community">;
		readonly SOCIAL: ScopePermissions<"community">;
		readonly COMMENTS: ScopePermissions<"community">;
		readonly ATTACHMENTS: ScopePermissions<"community">;
	};
	readonly PROJECT_MANAGER: {
		readonly PROJECTS: ScopePermissions<"project-manager">;
		readonly ISSUES: ScopePermissions<"project-manager">;
		readonly SPRINTS: ScopePermissions<"project-manager">;
		readonly MILESTONES: ScopePermissions<"project-manager">;
		readonly CUSTOM_FIELDS: ScopePermissions<"project-manager">;
		readonly ATTACHMENTS: ScopePermissions<"project-manager">;
		readonly SETTINGS: ScopePermissions<"project-manager">;
		readonly STATS: ScopePermissions<"project-manager">;
		readonly COMMENTS: ScopePermissions<"project-manager">;
	};
};

/**
 * Checks if any user permission satisfies `required` using bitfield matching.
 *
 * @param userPerms  - Permission strings from the user's session/roles
 * @param required   - A permission constant from `P`, e.g. `P.COMMUNITY.SOCIAL.WRITE`
 *
 * Fast path: exact string match (`includes`).
 * Slow path: bitwise AND on scope & action for same-resource permissions.
 */
export function hasPermissionString(userPerms: readonly string[], required: string): boolean {
	if (!userPerms.length) return false;
	if (userPerms.includes("*") || userPerms.includes(required)) return true;

	const dot1 = required.indexOf(".");
	const dot2 = required.indexOf(".", dot1 + 1);
	if (dot1 === -1 || dot2 === -1) return false;

	const prefix = required.slice(0, dot1 + 1); // "community."
	const reqScope = Number(required.slice(dot1 + 1, dot2));
	const reqAction = Number(required.slice(dot2 + 1));

	for (const p of userPerms) {
		if (!p.startsWith(prefix)) continue;
		const d1 = prefix.length;
		const d2 = p.indexOf(".", d1);
		if (d2 === -1) continue;
		const scope = Number(p.slice(d1, d2));
		const action = Number(p.slice(d2 + 1));
		if ((scope & reqScope) === reqScope && (action & reqAction) === reqAction) return true;
	}
	return false;
}
