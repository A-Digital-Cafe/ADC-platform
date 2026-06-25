/**
 * Contrato del provider JWT. Vive en `@interfaces` (como IHttpServer/IStorage/
 * IMessageQueue) para que los consumidores —p.ej. SessionManagerService— dependan
 * del contrato y no de los internos del provider `security/jwt`.
 */

/**
 * Payload del JWT de sesión
 * Extiende Record para ser compatible con jose.JWTPayload
 */
export interface TokenPayload extends Record<string, unknown> {
	/** ID del usuario en la DB */
	userId: string;
	/** Permisos en formato [resource].[scope].action */
	permissions: string[];
	/** ID del dispositivo (para vincular con refresh token) */
	deviceId?: string;
	/** Metadatos adicionales (org, etc) */
	metadata?: Record<string, unknown>;
	/** Timestamp de creación del token */
	iat?: number;
	/** Timestamp de expiración del token */
	exp?: number;
}

/** Resultado de verificación de token */
export interface TokenVerificationResult {
	valid: boolean;
	payload?: TokenPayload;
	error?: string;
}

/** Interface del JWT Provider (básica) */
export interface IJWTProvider {
	/** Crea un JWT cifrado con el payload proporcionado */
	encrypt(payload: TokenPayload): Promise<string>;

	/** Descifra y verifica un JWT */
	decrypt(token: string): Promise<TokenVerificationResult>;

	/** Verifica si un token es válido sin descifrar el payload completo */
	verify(token: string): Promise<boolean>;
}

/** Interface extendida del JWT Provider con soporte multi-key */
export interface IJWTProviderMultiKey extends IJWTProvider {
	/** Crea un JWT cifrado con una clave específica */
	encryptWithKey(payload: TokenPayload, key: Uint8Array, expiresIn: string): Promise<string>;

	/** Descifra un JWT con una clave específica */
	decryptWithKey(token: string, key: Uint8Array): Promise<TokenVerificationResult>;
}
