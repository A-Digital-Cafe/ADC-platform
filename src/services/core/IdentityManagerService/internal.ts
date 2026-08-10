import type { Model } from "mongoose";
import type { UserManager, OrgManager, RoleManager } from "./dao/index.js";
import type { DiscordGuildConfig } from "./domain/index.js";
import type { EmailBinder } from "./emailBinding.js";

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
	/**
	 * Trae a nuestro almacenamiento el avatar que trae una cuenta OAuth (alta o vinculación) y
	 * deja apuntada una URL propia. Vive acá porque escribe el avatar de un usuario arbitrario
	 * y porque quien vincula (SessionManager) no debe conocer S3 ni los adjuntos.
	 *
	 * Best-effort: nunca lanza. Lo que NO puede pasar es que la URL del proveedor quede guardada
	 * —la pediría el navegador de cada visitante—, así que un fallo deja la cuenta sin avatar.
	 */
	ingestProviderAvatar(userId: string, remoteAvatarUrl?: string): Promise<void>;
	/**
	 * Vincula una dirección a una cuenta **sin revelar si ya existía** (ver `emailBinding.ts`).
	 * Vive acá y no en la superficie pública porque escribe el email de un usuario arbitrario; y
	 * está acá (y no en el consumidor) para que SessionManager no tenga que conocer al EmailService.
	 */
	bindEmailNeutrally: EmailBinder;
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
export function buildInternalApi(
	users: UserManager,
	organizations: OrgManager,
	roles: RoleManager,
	bindEmailNeutrally: EmailBinder,
	ingestProviderAvatar: IdentityInternalApi["ingestProviderAvatar"]
): IdentityInternalApi {
	return {
		users,
		organizations,
		roles,
		bindEmailNeutrally,
		ingestProviderAvatar,
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
