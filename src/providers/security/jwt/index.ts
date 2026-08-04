import * as jose from "jose";
import { BaseProvider } from "../../BaseProvider.js";
import { parseDurationSeconds } from "@common/utils/duration.js";
import { sha256Bytes } from "@common/utils/crypto.js";
import type { TokenPayload, IJWTProviderMultiKey, JWTProviderConfig, TokenVerificationResult } from "./types.d.ts";

/** Largo mínimo recomendado del secreto; por debajo se avisa (no se bloquea el boot). */
const MIN_SECRET_LENGTH = 32;

/**
 * JWTProvider - Cifrado y descifrado de tokens JWT usando jose
 *
 * Implementa JWE (JSON Web Encryption) para tokens seguros.
 * Los tokens son firmados y cifrados para máxima seguridad.
 *
 * Soporta:
 * - Operaciones con clave por defecto (básica)
 * - Operaciones con clave específica (para rotación de secretos)
 */
export default class JWTProvider extends BaseProvider implements IJWTProviderMultiKey {
	public readonly name = "jwt";
	public readonly type = "security-token";

	#secretKey: Uint8Array | null = null;
	readonly #config: JWTProviderConfig;

	constructor(options?: any) {
		super();
		this.#config = {
			secret: options?.jwtSecret || "",
			encryptionAlgorithm: "A256GCM",
			keyEncryptionAlgorithm: "dir",
			expiresIn: "7d",
			issuer: "adc-platform",
			audience: "adc-platform",
		};
	}

	async start(kernelKey: symbol): Promise<void> {
		await super.start(kernelKey);

		const secret = this.#config.secret;
		if (secret) {
			// A256GCM necesita exactamente 32 bytes: se derivan con SHA-256 del secreto, sea cual
			// sea su largo (rellenar/truncar caracteres descartaría entropía de un secreto fuerte).
			this.#secretKey = sha256Bytes(secret);
			if (secret.length < MIN_SECRET_LENGTH) {
				// logError, no warn: con `dir` la clave derivada ES la de cifrado, así que un
				// secreto corto hace forjables los tokens. No se lanza para no convertir una
				// config que hoy arranca (SessionManagerService es kernelMode con
				// `failOnError: true`) en una caída de boot, pero tiene que verse.
				this.logger.logError(
					`JWTProvider: jwtSecret tiene ${secret.length} caracteres y el contrato pide al menos ${MIN_SECRET_LENGTH}. ` +
						`Derivar la clave no crea entropía que el secreto no tenga: los tokens emitidos con ella son débiles.`
				);
			}
		} else {
			// Sin secreto no se puede operar con la clave por defecto. No se lanza: SessionManager
			// usa su propio KeyStore vía `encryptWithKey`, así que el kernel arranca igual; el que
			// llame a `encrypt()` sin clave recibe el error explícito de ahí.
			this.logger.logWarn("JWTProvider sin `jwtSecret`: las operaciones con la clave por defecto no van a estar disponibles.");
		}
		this.logger.logOk("JWTProvider iniciado");
	}

	async stop(kernelKey: symbol): Promise<void> {
		await super.stop(kernelKey);
		this.#secretKey = null;
	}

	/**
	 * Crea un JWT cifrado (JWE) con el payload proporcionado
	 * Usa la clave por defecto del provider
	 */
	async encrypt(payload: TokenPayload): Promise<string> {
		if (!this.#secretKey || this.#secretKey.length < 32) {
			throw new Error("JWTProvider no está inicializado correctamente");
		}

		return this.encryptWithKey(payload, this.#secretKey, this.#config.expiresIn || "7d");
	}

	/**
	 * Crea un JWT cifrado (JWE) con una clave específica
	 * Permite usar claves del KeyStore para rotación
	 */
	async encryptWithKey(payload: TokenPayload, key: Uint8Array, expiresIn: string): Promise<string> {
		const now = Math.floor(Date.now() / 1000);
		const expiresInSeconds = this.#parseExpiration(expiresIn);

		// Crear JWT cifrado (JWE)
		const token = await new jose.EncryptJWT(payload as unknown as jose.JWTPayload)
			.setProtectedHeader({
				alg: this.#config.keyEncryptionAlgorithm as "dir",
				enc: this.#config.encryptionAlgorithm as "A256GCM",
			})
			.setIssuedAt(now)
			.setExpirationTime(now + expiresInSeconds)
			.setIssuer(this.#config.issuer!)
			.setAudience(this.#config.audience!)
			.encrypt(key);

		return token;
	}

	// Descifra y verifica un JWT usando la clave por defecto
	async decrypt(token: string): Promise<TokenVerificationResult> {
		if (!this.#secretKey) {
			return { valid: false, error: "JWTProvider no está inicializado" };
		}

		return this.decryptWithKey(token, this.#secretKey);
	}

	/**
	 * Descifra y verifica un JWT usando una clave específica
	 * Permite verificar con claves del KeyStore (current o previous)
	 */
	async decryptWithKey(token: string, key: Uint8Array): Promise<TokenVerificationResult> {
		try {
			const { payload } = await jose.jwtDecrypt(token, key, {
				issuer: this.#config.issuer,
				audience: this.#config.audience,
			});

			return {
				valid: true,
				payload: payload as TokenPayload,
			};
		} catch (error: any) {
			// Distinguir entre token expirado y otros errores
			if (error instanceof jose.errors.JWTExpired) {
				return { valid: false, error: "Token expirado" };
			}

			// Error de descifrado (clave incorrecta)
			if (error instanceof jose.errors.JWEDecryptionFailed) {
				return { valid: false, error: "Clave incorrecta" };
			}

			// Otros errores
			return { valid: false, error: error.message || "Token inválido" };
		}
	}

	// Verifica si un token es válido
	async verify(token: string): Promise<boolean> {
		const result = await this.decrypt(token);
		return result.valid;
	}

	// Verifica si un token es válido con una clave específica
	async verifyWithKey(token: string, key: Uint8Array): Promise<boolean> {
		const result = await this.decryptWithKey(token, key);
		return result.valid;
	}

	// Parsea string de expiración a segundos (default 7 días si el formato no es válido)
	#parseExpiration(exp: string): number {
		return parseDurationSeconds(exp) ?? 7 * 24 * 60 * 60;
	}
}
