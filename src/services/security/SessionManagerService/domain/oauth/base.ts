import type { IOAuthProvider, OAuthProviderConfig, ProviderUserProfile, TokenExchangeResult } from "../../types.js";

/**
 * Clase base abstracta para proveedores OAuth
 * Implementa el patrón Template Method para OAuth 2.0
 */
export abstract class BaseOAuthProvider implements IOAuthProvider {
	abstract readonly name: string;

	/** URL del endpoint de autorización */
	protected abstract readonly authorizationEndpoint: string;
	/** URL del endpoint de token */
	protected abstract readonly tokenEndpoint: string;
	/** URL del endpoint de perfil de usuario */
	protected abstract readonly userInfoEndpoint: string;

	/**
	 * Genera la URL de autorización para redirigir al usuario
	 */
	getAuthorizationUrl(state: string, config: OAuthProviderConfig): string {
		const params = new URLSearchParams({
			client_id: config.clientId,
			redirect_uri: config.redirectUri,
			response_type: "code",
			state: state,
			scope: config.scopes.join(" "),
		});

		// Permitir parámetros adicionales específicos del provider
		const additionalParams = this.getAdditionalAuthParams();
		for (const [key, value] of Object.entries(additionalParams)) {
			params.set(key, value);
		}

		return `${this.authorizationEndpoint}?${params.toString()}`;
	}

	/**
	 * Intercambia el código de autorización por tokens
	 */
	async exchangeCode(code: string, config: OAuthProviderConfig): Promise<TokenExchangeResult> {
		const body = new URLSearchParams({
			client_id: config.clientId,
			client_secret: config.clientSecret,
			code: code,
			grant_type: "authorization_code",
			redirect_uri: config.redirectUri,
		});

		const response = await fetch(this.tokenEndpoint, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				Accept: "application/json",
			},
			body: body.toString(),
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`Error intercambiando código: ${error}`);
		}

		const data = await response.json();
		return this.parseTokenResponse(data);
	}

	/**
	 * Obtiene el perfil del usuario usando el access token
	 */
	async getUserProfile(accessToken: string): Promise<ProviderUserProfile> {
		const response = await fetch(this.userInfoEndpoint, {
			headers: {
				Authorization: `Bearer ${accessToken}`,
				Accept: "application/json",
			},
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`Error obteniendo perfil: ${error}`);
		}

		const data = await response.json();
		return this.parseUserProfile(data);
	}

	/**
	 * Parámetros adicionales específicos del provider para la URL de autorización
	 */
	protected getAdditionalAuthParams(): Record<string, string> {
		return {};
	}

	/**
	 * Parsea la respuesta del endpoint de token
	 */
	protected parseTokenResponse(data: any): TokenExchangeResult {
		return {
			accessToken: data.access_token,
			refreshToken: data.refresh_token,
			expiresIn: data.expires_in,
			tokenType: data.token_type || "Bearer",
		};
	}

	/**
	 * Parsea el perfil del usuario - debe ser implementado por cada provider
	 */
	protected abstract parseUserProfile(data: any): ProviderUserProfile;
}
