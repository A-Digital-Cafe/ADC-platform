import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type RedisProvider from "../../../../../providers/queue/redis/index.js";

/**
 * Códigos de autorización: de un solo uso, vigencia corta, y atados al cliente que los pidió.
 *
 * Un código es un ticket canjeable por la identidad de una persona, así que las tres propiedades no
 * son configuración sino la definición: si se puede canjear dos veces, robarlo del historial del
 * navegador alcanza; si dura horas, la ventana para robarlo son horas; y si no está atado al
 * `redirect_uri` que lo originó, sirve para entregárselo a otro destino.
 */

/** Vigencia. El canje ocurre inmediatamente después del redirect: un minuto sobra. */
const CODE_TTL_SECONDS = 60;
const CODE_BYTES = 32;

export interface AuthorizationCode {
	clientId: string;
	userId: string;
	redirectUri: string;
	/** `code_challenge` de PKCE, siempre S256. */
	codeChallenge: string;
	nonce: string | null;
	scope: string;
	/** Momento del login que respalda este código, para poder ponerlo en `auth_time`. */
	authTime: number;
}

/**
 * PKCE con S256 y nada más.
 *
 * `plain` está en el RFC y no sirve para nada: el verificador viaja igual que el desafío, así que
 * quien pueda interceptar uno tiene el otro. Aceptarlo sería ofrecer una variante insegura del
 * mecanismo que existe para cerrar justamente ese hueco.
 */
export function verifyPkce(codeVerifier: string | undefined, challenge: string): boolean {
	if (!codeVerifier || codeVerifier.length < 43 || codeVerifier.length > 128) return false;
	const computed = createHash("sha256").update(codeVerifier).digest("base64url");
	const a = Buffer.from(computed);
	const b = Buffer.from(challenge);
	return a.length === b.length && timingSafeEqual(a, b);
}

export class AuthorizationCodeStore {
	readonly #redis: RedisProvider | null;
	/** Respaldo en memoria para desarrollo sin Redis. No se comparte entre nodos, y está bien: sin Redis tampoco hay clúster. */
	readonly #memory = new Map<string, { value: AuthorizationCode; expiresAt: number }>();

	constructor(redis: RedisProvider | null) {
		this.#redis = redis;
	}

	async issue(data: AuthorizationCode): Promise<string> {
		const code = randomBytes(CODE_BYTES).toString("base64url");
		if (this.#redis) await this.#redis.set(this.#key(code), JSON.stringify(data), CODE_TTL_SECONDS);
		else this.#memory.set(code, { value: data, expiresAt: Date.now() + CODE_TTL_SECONDS * 1000 });
		return code;
	}

	/**
	 * Lee y **borra** el código: el borrado es parte del canje, no una limpieza posterior. Se hace
	 * antes de validar nada del cliente, de modo que un canje fallido igual lo consume — un atacante
	 * que adivina el `redirect_uri` no puede usar los intentos para ir probando.
	 */
	async consume(code: string | undefined): Promise<AuthorizationCode | null> {
		if (!code) return null;
		if (!this.#redis) {
			const hit = this.#memory.get(code);
			this.#memory.delete(code);
			return hit && hit.expiresAt > Date.now() ? hit.value : null;
		}
		const key = this.#key(code);
		const raw = await this.#redis.get(key);
		await this.#redis.del(key);
		if (!raw) return null;
		try {
			return JSON.parse(raw) as AuthorizationCode;
		} catch {
			return null;
		}
	}

	#key(code: string): string {
		return `oidc:code:${code}`;
	}
}
