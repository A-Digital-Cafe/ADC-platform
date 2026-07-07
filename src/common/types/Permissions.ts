import { CRUDXAction } from "./Actions.js";
import { RESOURCES, RESOURCE_MAP, type ResourceDef, type ScopeDef } from "./resources.js";

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

function buildScopePermissions<R extends string>(resource: R, scope: ScopeDef): ScopePermissions<R> {
	return {
		READ: `${resource}.${scope.value}.${CRUDXAction.READ}`,
		WRITE: `${resource}.${scope.value}.${CRUDXAction.WRITE}`,
		UPDATE: `${resource}.${scope.value}.${CRUDXAction.UPDATE}`,
		DELETE: `${resource}.${scope.value}.${CRUDXAction.DELETE}`,
		EXECUTE: `${resource}.${scope.value}.${CRUDXAction.EXECUTE}`,
		CRUD: `${resource}.${scope.value}.${CRUDXAction.CRUD}`,
		ALL: `${resource}.${scope.value}.${CRUDXAction.ALL}`,
	};
}

function buildResourcePermissions(resource: ResourceDef) {
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
 * Formato: `resource.scopeBits.actionBits`
 *   `P.IDENTITY.USERS.READ`  → `"identity.2.1"`
 *   `P.IDENTITY.ROLES.WRITE` → `"identity.4.2"`
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
	readonly STORAGE: {
		readonly USAGE: ScopePermissions<"storage">;
		readonly LIMITS: ScopePermissions<"storage">;
	};
	readonly DRIVE: {
		readonly RECOVER: ScopePermissions<"drive">;
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
	readonly EMAIL: {
		readonly MESSAGES: ScopePermissions<"email">;
		readonly SEND: ScopePermissions<"email">;
		readonly DRAFTS: ScopePermissions<"email">;
		readonly ATTACHMENTS: ScopePermissions<"email">;
		readonly ACCOUNTS: ScopePermissions<"email">;
		readonly SETTINGS: ScopePermissions<"email">;
	};
	readonly SECURITY: {
		readonly SESSIONS: ScopePermissions<"security">;
		readonly AUDIT: ScopePermissions<"security">;
	};
	readonly MODULES: {
		readonly RUNTIME: ScopePermissions<"modules">;
		readonly GIT: ScopePermissions<"modules">;
		readonly BANNERS: ScopePermissions<"modules">;
		readonly SCHEDULE: ScopePermissions<"modules">;
		readonly AUDIT: ScopePermissions<"modules">;
	};
};

/**
 * Checks if any user permission satisfies `required` using bitfield matching.
 *
 * @param userPerms  - Permission strings from the user's session/roles
 * @param required   - A permission constant from `P`, e.g. `P.COMMUNITY.SOCIAL.WRITE`
 *
 * Fast path: exact string match (`includes`).
 * Slow path: bitwise AND on scope & action para el mismo recurso o el comodín
 * (`*.<scope>.<action>`, p.ej. el rol Admin: `*.65535.31`).
 */
export function hasPermissionString(userPerms: readonly string[], required: string): boolean {
	if (!userPerms.length) return false;
	if (userPerms.includes("*") || userPerms.includes(required)) return true;

	const dot1 = required.indexOf(".");
	const dot2 = required.indexOf(".", dot1 + 1);
	if (dot1 === -1 || dot2 === -1) return false;

	const resource = required.slice(0, dot1);
	const reqScope = Number(required.slice(dot1 + 1, dot2));
	const reqAction = Number(required.slice(dot2 + 1));

	for (const p of userPerms) {
		const d1 = p.indexOf(".");
		if (d1 === -1) continue;
		const pResource = p.slice(0, d1);
		if (pResource !== resource && pResource !== "*") continue;
		const d2 = p.indexOf(".", d1 + 1);
		if (d2 === -1) continue;
		const scope = Number(p.slice(d1 + 1, d2));
		const action = Number(p.slice(d2 + 1));
		if ((scope & reqScope) === reqScope && (action & reqAction) === reqAction) return true;
	}
	return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Human-readable permission descriptions
// ─────────────────────────────────────────────────────────────────────────────

/** Acciones atómicas (bit → nombre) para descomponer el bitfield de acción. */
const ATOMIC_ACTIONS: ReadonlyArray<readonly [number, string]> = [
	[CRUDXAction.READ, "read"],
	[CRUDXAction.WRITE, "write"],
	[CRUDXAction.UPDATE, "update"],
	[CRUDXAction.DELETE, "delete"],
	[CRUDXAction.EXECUTE, "execute"],
];

/** Convierte un bitfield de acción en una etiqueta legible (`delete`, `read+write`, `crud`, `all`). */
function actionToLabel(action: number): string {
	if (action === CRUDXAction.ALL) return "all";
	if (action === CRUDXAction.CRUD) return "crud";
	const names = ATOMIC_ACTIONS.filter(([bit]) => (action & bit) === bit).map(([, name]) => name);
	return names.length > 0 ? names.join("+") : String(action);
}

/** Convierte un bitfield de scope en sus claves (`groups`, `groups+users`). */
function scopeToLabel(resource: ResourceDef, scopeBits: number): string {
	const keys = resource.scopes.filter((s) => (scopeBits & s.value) === s.value).map((s) => s.key);
	return keys.length > 0 ? keys.join("+") : String(scopeBits);
}

/**
 * Traduce un permiso a una etiqueta legible para documentación/logs.
 *
 * - Scoped (`identity.8.8`) → `identity:groups (delete)`
 * - Combinado (`identity.10.2`) → `identity:groups+users (write)`
 *
 * Si el permiso no se reconoce, se devuelve tal cual (fallback seguro).
 *
 * @public
 */
export function describePermission(permission: string): string {
	const parts = permission.split(".");

	// Scoped: `resource.scopeBits.actionBits`
	if (parts.length === 3) {
		const [resourceId, scopeRaw, actionRaw] = parts;
		const resource = RESOURCE_MAP.get(resourceId);
		const scopeBits = Number(scopeRaw);
		const actionBits = Number(actionRaw);
		if (resource && Number.isFinite(scopeBits) && Number.isFinite(actionBits)) {
			return `${resourceId}:${scopeToLabel(resource, scopeBits)} (${actionToLabel(actionBits)})`;
		}
	}

	return permission;
}
