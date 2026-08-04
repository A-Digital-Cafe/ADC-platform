import { UserAuthenticationResult } from "../../../../core/IdentityManagerService/dao/users.ts";
import type { IOAuthProvider, OAuthProviderConfig, ProviderUserProfile, TokenExchangeResult } from "../../types.js";

/**
 * Proveedor de autenticación nativo de la plataforma
 * Este provider maneja el login con username/password contra la base de datos local
 */
export class PlatformAuthProvider implements IOAuthProvider {
	readonly name = "platform";

	readonly #validateCredentials: (username: string, password: string) => Promise<UserAuthenticationResult | null>;

	constructor(validateFn: (username: string, password: string) => Promise<UserAuthenticationResult | null>) {
		this.#validateCredentials = validateFn;
	}

	/**
	 * Para autenticación de plataforma, la URL de autorización redirige a la página de login
	 */
	getAuthorizationUrl(state: string, config: OAuthProviderConfig): string {
		const params = new URLSearchParams({
			state: state,
			redirect_uri: config.redirectUri,
		});
		return `/auth/login?${params.toString()}`;
	}

	/**
	 * No aplica para autenticación de plataforma
	 */
	async exchangeCode(_code: string, _config: OAuthProviderConfig): Promise<TokenExchangeResult> {
		throw new Error("PlatformAuthProvider no usa intercambio de código OAuth");
	}

	/**
	 * Valida credenciales y retorna el perfil del usuario
	 */
	async getUserProfile(_accessToken: string): Promise<ProviderUserProfile> {
		throw new Error("PlatformAuthProvider requiere validación de credenciales");
	}

	/**
	 * Valida las credenciales del usuario contra la base de datos
	 */
	async validateCredentials(username: string, password: string): Promise<UserAuthenticationResult | null> {
		return this.#validateCredentials(username, password);
	}
}
