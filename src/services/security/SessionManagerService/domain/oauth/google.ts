import type { ProviderUserProfile } from "../../types.js";
import { BaseOAuthProvider } from "./base.js";

/**
 * Proveedor OAuth para Google
 */
export class GoogleOAuthProvider extends BaseOAuthProvider {
	readonly name = "google";

	protected readonly authorizationEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";
	protected readonly tokenEndpoint = "https://oauth2.googleapis.com/token";
	protected readonly userInfoEndpoint = "https://www.googleapis.com/oauth2/v2/userinfo";

	protected getAdditionalAuthParams(): Record<string, string> {
		return {
			access_type: "offline",
			prompt: "consent",
		};
	}

	protected parseUserProfile(data: Record<string, any>): ProviderUserProfile {
		return {
			id: data.id,
			username: data.name || data.email?.split("@")[0] || "user",
			email: data.email,
			// `verified_email` es el campo del endpoint v2 en uso; `email_verified` es el de
			// OIDC, por si el endpoint cambia. Sin ninguno de los dos, el email no se confía.
			emailVerified: data.verified_email === true || data.email_verified === true,
			// URL en el CDN de Google: pista de ingesta, no se persiste (ver `avatarIngestUrl`).
			avatarIngestUrl: data.picture,
			metadata: data,
		};
	}
}
