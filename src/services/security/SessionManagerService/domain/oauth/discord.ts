import type { ProviderUserProfile } from "../../types.js";
import { BaseOAuthProvider } from "./base.js";

/**
 * Proveedor OAuth para Discord
 */
export class DiscordOAuthProvider extends BaseOAuthProvider {
	readonly name = "discord";

	protected readonly authorizationEndpoint = "https://discord.com/api/oauth2/authorize";
	protected readonly tokenEndpoint = "https://discord.com/api/oauth2/token";
	protected readonly userInfoEndpoint = "https://discord.com/api/users/@me";

	protected getAdditionalAuthParams(): Record<string, string> {
		return {
			prompt: "consent",
		};
	}

	protected parseUserProfile(data: Record<string, any>): ProviderUserProfile {
		// URL del CDN de Discord: sólo para que el servidor se baje la imagen una vez y la
		// guarde como propia (ver `avatarIngestUrl`). Nunca se persiste ni se sirve.
		let avatarIngestUrl: string | undefined;
		if (data.avatar) {
			const ext = data.avatar.startsWith("a_") ? "gif" : "png";
			avatarIngestUrl = `https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.${ext}`;
		}

		return {
			id: data.id,
			username: data.username,
			email: data.email,
			// `verified` de `/users/@me`: Discord deja poner cualquier email en la cuenta,
			// así que sin este flag el email no identifica a nadie.
			emailVerified: data.verified === true,
			avatarIngestUrl,
			metadata: data,
		};
	}

	/**
	 * Obtiene los role IDs del usuario en un guild de Discord.
	 * Usa el scope `guilds.members.read` para obtener info de membresía.
	 *
	 * @param accessToken Token OAuth del usuario
	 * @param guildId ID del guild de Discord
	 * @returns Array de Discord role IDs, o null si falla/rate-limited
	 */
	async fetchGuildMemberRoles(accessToken: string, guildId: string): Promise<string[] | null> {
		try {
			const response = await fetch(`https://discord.com/api/v10/users/@me/guilds/${guildId}/member`, {
				headers: {
					Authorization: `Bearer ${accessToken}`,
					Accept: "application/json",
				},
			});

			if (response.status === 429) {
				// Rate limited — gracefully return null
				console.warn(`[Discord] Rate limited al obtener roles del guild ${guildId}`);
				return null;
			}

			if (!response.ok) {
				// Usuario no es miembro del guild, o error
				return null;
			}

			const data = await response.json();
			return data.roles || [];
		} catch {
			return null;
		}
	}
}
