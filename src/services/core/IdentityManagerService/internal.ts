import type { Model } from "mongoose";
import type { UserManager, OrgManager, RoleManager } from "./dao/index.js";
import type { DiscordGuildConfig } from "./domain/index.js";

/**
 * Superficies internas de IdentityManager, **separadas por scope** para least‑privilege.
 * Cada una se obtiene por un método gateado distinto (`_internal`/`_internalAvatar`/
 * `_internalDiscord`); un consumidor declara sólo el/los scope(s) que usa.
 *
 * El código vive aquí (no en `index.ts`) para no inflar el shell del servicio.
 */

/** Managers de users/orgs/roles (scope `identity:internal`). */
export interface IdentityInternalApi {
	users: UserManager;
	organizations: OrgManager;
	roles: RoleManager;
	getUserIdsByRoleName(roleName: string): Promise<string[]>;
}

/**
 * Superficie de avatares (scope `identity:avatar`): sólo agregación de uso para cuota,
 * pre‑ligada al token de Identity (el consumidor —StorageQuota— no cruza key alguna).
 */
export interface IdentityAvatarApi {
	avatarAttachments: {
		aggregateUsageByUser(): Promise<Array<{ userId: string; orgId: string | null; bytes: number; count: number }>>;
	} | null;
}

/** Mapeo de roles Discord (scope `identity:discord`). */
export interface IdentityDiscordApi {
	discordGuildId: string | undefined;
	getDiscordRoleMap(guildId: string): Promise<Record<string, string> | null>;
}

/**
 * Superficie combinada internal + discord, para consumidores que necesitan ambos
 * (p.ej. el sync de roles Discord de SessionManager, que lee users/roles **y** el
 * mapeo de roles). Requiere declarar `identity:internal` **e** `identity:discord`.
 */
export type IdentityInternalWithDiscord = IdentityInternalApi & IdentityDiscordApi;

type DiscordConfigPrivate = { discordGuildId?: string; discordRoleMap?: Record<string, string> };

/** Construye la superficie users/orgs/roles. Los managers ya deben estar inicializados. */
export function buildInternalApi(users: UserManager, organizations: OrgManager, roles: RoleManager): IdentityInternalApi {
	return {
		users,
		organizations,
		roles,
		/**
		 * IDs de usuarios con un **rol global** por nombre (ej. `SystemRole.ADMIN`). Usa los
		 * managers sin auth; por eso vive tras el gate (enumeraría destinatarios privilegiados).
		 */
		getUserIdsByRoleName: async (roleName: string): Promise<string[]> => {
			const role = await roles.getRoleByName(roleName).catch(() => null);
			if (!role?.id) return [];
			return (await users.getUsersByRole(role.id)) ?? [];
		},
	};
}

/** Construye la superficie Discord (Role ID → nombre de rol; DB por guild con fallback a config). */
export function buildDiscordApi(
	discordGuildConfigModel: Model<DiscordGuildConfig> | null,
	configPrivate: DiscordConfigPrivate
): IdentityDiscordApi {
	return {
		discordGuildId: configPrivate.discordGuildId,
		getDiscordRoleMap: async (guildId: string): Promise<Record<string, string> | null> => {
			if (discordGuildConfigModel) {
				try {
					const doc = await discordGuildConfigModel.findOne({ guildId });
					if (doc) return (doc.toObject?.() || doc).roleMap;
				} catch {
					/* fallback a config.json */
				}
			}
			if (guildId === configPrivate.discordGuildId && configPrivate.discordRoleMap) {
				return configPrivate.discordRoleMap;
			}
			return null;
		},
	};
}
