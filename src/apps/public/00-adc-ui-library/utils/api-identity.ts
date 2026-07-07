import { createAdcApi, assertSafeId } from "./adc-fetch.js";
import type { ClientUser } from "@common/types/identity/User.ts";
import type { Role } from "@common/types/identity/Role.ts";
import type { Permission } from "@common/types/identity/Permission.ts";
import type { Group } from "@common/types/identity/Group.ts";
import type { Organization } from "@common/types/identity/Organization.ts";
import type { RegionInfo } from "@common/types/identity/Region.ts";

/**
 * Cliente compartido de Identity API (endpoints de IdentityManagerService).
 * Fuente única para todas las apps: no duplicar este cliente por app.
 * La política de credentials la define `createAdcApi` (include en dev, same-origin en prod).
 */
const api = createAdcApi({
	basePath: "/api/identity",
	devPort: 3000,
});

// ── API methods ──────────────────────────────────────────────────────────────

export const identityApi = {
	// Users
	listUsers: (orgId?: string) => api.get<{ users: ClientUser[]; roles: Role[] }>("/users", orgId ? { params: { orgId } } : undefined),
	searchUsers: (q: string, orgId?: string) => api.get<ClientUser[]>("/users/search", { params: { q, orgId } }),
	getUser: (userId: string) => api.get<ClientUser>(`/users/${assertSafeId(userId, "userId")}`),
	/** HEAD /users/username/:username → 200 si el username ya está tomado, 404 si está libre. */
	checkUsernameExists: (username: string, signal?: AbortSignal) =>
		api.head(`/users/username/${encodeURIComponent(username)}`, { signal, silent: true }),
	createUser: (data: { username: string; password: string; roleIds?: string[]; orgId?: string }) =>
		api.post<ClientUser>("/users", { body: data, idempotencyData: data }),
	updateUser: (userId: string, data: Partial<ClientUser>, orgId?: string) =>
		api.put<ClientUser>(`/users/${assertSafeId(userId, "userId")}`, {
			body: data,
			params: { orgId },
			idempotencyData: { userId, orgId: orgId ?? null, data },
		}),
	deleteUser: (userId: string, orgId?: string) =>
		api.delete(`/users/${assertSafeId(userId, "userId")}`, { params: { orgId }, idempotencyData: { userId, orgId: orgId ?? null } }),

	// Roles
	listRoles: (orgId?: string) => api.get<Role[]>("/roles", orgId ? { params: { orgId } } : undefined),
	getRole: (roleId: string) => api.get<Role>(`/roles/${assertSafeId(roleId, "roleId")}`),
	createRole: (data: { name: string; description: string; permissions?: Permission[]; orgId?: string; hierarchy?: number }) =>
		api.post<Role>("/roles", { body: data, idempotencyData: data }),
	updateRole: (roleId: string, data: Partial<Role>) =>
		api.put<Role>(`/roles/${assertSafeId(roleId, "roleId")}`, { body: data, idempotencyData: { roleId, data } }),
	deleteRole: (roleId: string) => api.delete(`/roles/${assertSafeId(roleId, "roleId")}`, { idempotencyKey: roleId }),

	// Groups
	listGroups: (orgId?: string) => api.get<Group[]>("/groups", orgId ? { params: { orgId } } : undefined),
	getGroup: (groupId: string) => api.get<Group>(`/groups/${assertSafeId(groupId, "groupId")}`),
	createGroup: (data: { name: string; description: string; roleIds?: string[]; orgId?: string }) =>
		api.post<Group>("/groups", { body: data, idempotencyData: data }),
	updateGroup: (groupId: string, data: Partial<Group>) =>
		api.put<Group>(`/groups/${assertSafeId(groupId, "groupId")}`, { body: data, idempotencyData: { groupId, data } }),
	deleteGroup: (groupId: string) => api.delete(`/groups/${assertSafeId(groupId, "groupId")}`, { idempotencyKey: groupId }),
	listGroupMembers: (groupId: string) => api.get<ClientUser[]>(`/groups/${assertSafeId(groupId, "groupId")}/users`),
	addUserToGroup: (groupId: string, userId: string, orgId?: string) =>
		api.post(`/groups/${assertSafeId(groupId, "groupId")}/users/${assertSafeId(userId, "userId")}`, {
			params: { orgId },
			idempotencyData: { groupId, userId, orgId: orgId ?? null },
		}),
	removeUserFromGroup: (groupId: string, userId: string, orgId?: string) =>
		api.delete(`/groups/${assertSafeId(groupId, "groupId")}/users/${assertSafeId(userId, "userId")}`, {
			params: { orgId },
			idempotencyData: { groupId, userId, orgId: orgId ?? null },
		}),

	// Organizations
	listOrganizations: () => api.get<Organization[]>("/organizations"),
	getOrganization: (orgId: string) => api.get<Organization>(`/organizations/${assertSafeId(orgId, "orgId")}`),
	createOrganization: (data: { slug: string; region?: string; metadata?: Record<string, any> }) =>
		api.post<Organization>("/organizations", { body: data, idempotencyData: data }),
	updateOrganization: (orgId: string, data: Partial<Organization>) =>
		api.put<Organization>(`/organizations/${assertSafeId(orgId, "orgId")}`, { body: data, idempotencyData: { orgId, data } }),
	deleteOrganization: (orgId: string) => api.delete(`/organizations/${assertSafeId(orgId, "orgId")}`, { idempotencyKey: orgId }),
	listOrgMembers: (orgId: string) => api.get<ClientUser[]>(`/organizations/${assertSafeId(orgId, "orgId")}/members`),
	addUserToOrg: (orgId: string, userId: string, roleIds?: string[]) =>
		api.post(`/organizations/${assertSafeId(orgId, "orgId")}/members/${assertSafeId(userId, "userId")}`, {
			...(roleIds ? { body: { roleIds } } : {}),
			idempotencyData: { orgId, userId, roleIds: roleIds ?? [] },
		}),
	removeUserFromOrg: (orgId: string, userId: string) =>
		api.delete(`/organizations/${assertSafeId(orgId, "orgId")}/members/${assertSafeId(userId, "userId")}`, {
			idempotencyData: { orgId, userId },
		}),

	// Regions
	listRegions: () => api.get<RegionInfo[]>("/regions"),
	createRegion: (data: { path: string; metadata: Record<string, any>; isGlobal?: boolean }) =>
		api.post<RegionInfo>("/regions", { body: data, idempotencyData: data }),
	updateRegion: (path: string, data: Partial<RegionInfo>) =>
		api.put<RegionInfo>(`/regions/${encodeURIComponent(path)}`, { body: data, idempotencyData: { path, data } }),
	deleteRegion: (path: string) => api.delete(`/regions/${encodeURIComponent(path)}`, { idempotencyKey: path }),

	// Stats
	getStats: () =>
		api.get<{ totalUsers: number; totalRoles: number; totalGroups: number; totalOrganizations: number; totalRegions: number }>("/stats"),
};
