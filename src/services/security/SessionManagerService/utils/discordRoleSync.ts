import type { User } from "@common/types/identity/User.js";
import type IdentityManagerService from "../../../core/IdentityManagerService/index.js";
import type { DiscordOAuthProvider } from "../domain/oauth/discord.js";

type InternalIdentity = ReturnType<IdentityManagerService["_internal"]>;
type RoleManager = InternalIdentity["roles"];

interface DiscordRoleSyncOptions {
	accessToken: string;
	userId: string;
	discordProvider: DiscordOAuthProvider;
	internalIdentity: InternalIdentity | null;
}

export async function syncDiscordRolesForUser(options: DiscordRoleSyncOptions): Promise<void> {
	const { accessToken, userId, discordProvider, internalIdentity } = options;
	if (!internalIdentity?.discordGuildId) return;

	const discordRoleIds = await discordProvider.fetchGuildMemberRoles(accessToken, internalIdentity.discordGuildId);
	if (!discordRoleIds) return;

	const roleMap = await internalIdentity.getDiscordRoleMap(internalIdentity.discordGuildId);
	if (!roleMap || Object.keys(roleMap).length === 0) return;

	const currentUser = await internalIdentity.users.getUser(userId);
	if (!currentUser) return;

	const mappedRoleNames = getMappedRoleNames(discordRoleIds, roleMap);
	const roleNameToId = await getRoleNameToId(Object.values(roleMap), internalIdentity.roles);
	const newRoleIds = buildSyncedRoleIds(currentUser, mappedRoleNames, roleNameToId);

	if (roleIdsChanged(currentUser.roleIds || [], newRoleIds)) {
		await internalIdentity.users.updateUser(userId, { roleIds: [...newRoleIds] });
	}
}

function getMappedRoleNames(discordRoleIds: string[], roleMap: Record<string, string>): Set<string> {
	const mappedRoleNames = new Set<string>();
	for (const discordRoleId of discordRoleIds) {
		const platformRoleName = roleMap[discordRoleId];
		if (platformRoleName) mappedRoleNames.add(platformRoleName);
	}
	return mappedRoleNames;
}

async function getRoleNameToId(roleNames: string[], roleManager: RoleManager): Promise<Map<string, string>> {
	const roleNameToId = new Map<string, string>();
	for (const roleName of new Set(roleNames)) {
		const role = await roleManager.getRoleByName(roleName);
		if (role) roleNameToId.set(roleName, role.id);
	}
	return roleNameToId;
}

function buildSyncedRoleIds(user: User, mappedRoleNames: Set<string>, roleNameToId: Map<string, string>): Set<string> {
	const allMappedRoleIds = new Set(roleNameToId.values());
	const newRoleIds = new Set<string>();

	for (const roleId of user.roleIds || []) {
		if (!allMappedRoleIds.has(roleId)) newRoleIds.add(roleId);
	}

	for (const roleName of mappedRoleNames) {
		const roleId = roleNameToId.get(roleName);
		if (roleId) newRoleIds.add(roleId);
	}

	return newRoleIds;
}

function roleIdsChanged(currentRoleIds: string[], newRoleIds: Set<string>): boolean {
	const sortedCurrent = [...currentRoleIds].sort((a, b) => a.localeCompare(b));
	const sortedNew = [...newRoleIds].sort((a, b) => a.localeCompare(b));
	return sortedCurrent.join(",") !== sortedNew.join(",");
}
