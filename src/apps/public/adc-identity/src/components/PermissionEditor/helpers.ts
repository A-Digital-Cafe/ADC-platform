import type { Permission } from "@common/types/identity/Permission.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Bitfield helpers (resource.scope.action)
// ─────────────────────────────────────────────────────────────────────────────

export function buildBitfieldMap(permissions: Permission[]): Map<string, number> {
	const map = new Map<string, number>();
	for (const perm of permissions) {
		const key = `${perm.resource}:${perm.scope}`;
		map.set(key, (map.get(key) ?? 0) | perm.action);
	}
	return map;
}

export function bitfieldMapToPermissions(permMap: Map<string, number>): Permission[] {
	const result: Permission[] = [];
	for (const [key, action] of permMap) {
		if (action > 0) {
			const [resource, scopeStr] = key.split(":");
			result.push({ resource, action, scope: Number(scopeStr) });
		}
	}
	return result;
}
