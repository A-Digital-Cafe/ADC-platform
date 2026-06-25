/**
 * El contrato del provider (payload, resultado, interfaces) vive en `@interfaces`
 * para no acoplar a los consumidores a este provider. Acá se re-exporta + la
 * config específica del provider.
 */
export type { TokenPayload, TokenVerificationResult, IJWTProvider, IJWTProviderMultiKey } from "@interfaces/modules/providers/IJWT.js";

/** Opciones de configuración del JWT (específicas de este provider) */
export interface JWTProviderConfig {
	/** Secreto para firmar JWTs (mínimo 32 caracteres) */
	secret: string;
	/** Algoritmo de encriptación (default: A256GCM) */
	encryptionAlgorithm?: string;
	/** Algoritmo de key encryption (default: dir) */
	keyEncryptionAlgorithm?: string;
	/** Tiempo de expiración (default: 7d) */
	expiresIn?: string;
	/** Issuer del token */
	issuer?: string;
	/** Audience del token */
	audience?: string;
}
