import { createHash, randomUUID } from "node:crypto";
import * as jose from "jose";
import { createAtRestSealer } from "@common/utils/at-rest-envelope.ts";
import type RedisProvider from "../../../../../providers/queue/redis/index.js";

/**
 * Clave de firma del proveedor OIDC de la plataforma.
 *
 * No reusa el provider de JWT de sesión porque ése emite **JWE**: tokens cifrados con clave
 * simétrica, opacos para todos salvo la plataforma. OIDC necesita lo contrario —que un tercero
 * pueda **verificar** sin poder emitir—, o sea firma asimétrica con clave pública publicada.
 *
 * Vive en Redis, sellada en reposo: Redis es compartido, así que todos los nodos firman con la
 * misma clave sin coordinarse, y está sin autenticar, así que la privada no puede quedar en claro
 * —quien la leyera podría fabricar identidades contra cualquiera que confíe en este emisor—.
 *
 * El JWKS publica la actual **y la anterior**, así que `rotate()` no invalida los tokens en vuelo:
 * el consumidor elige por `kid`. Rotar todavía no es automático.
 */
const keySeal = createAtRestSealer("adc:oidc-signing-keys");

const REDIS_KEYS = { CURRENT: "oidc:keys:current", PREVIOUS: "oidc:keys:previous" } as const;

/** RS256 y no ES256: es lo que aceptan todos los consumidores sin configurar nada. */
const ALG = "RS256";
const MODULUS_LENGTH = 2048;

/** Una clave con su identificador público. El `kid` es lo que permite rotar sin cortar. */
export interface SigningKey {
	kid: string;
	/** JWK privada, serializable. */
	jwk: jose.JWK;
}

interface StoredKey {
	kid: string;
	jwk: jose.JWK;
}

/**
 * El `kid` sale del hash de la clave pública y no de un random: el mismo material siempre da el
 * mismo identificador, así que un JWKS servido desde dos procesos nunca se contradice.
 */
function kidFor(publicJwk: jose.JWK): string {
	const canonical = JSON.stringify({ e: publicJwk.e, kty: publicJwk.kty, n: publicJwk.n });
	return createHash("sha256").update(canonical).digest("base64url").slice(0, 32);
}

async function generate(): Promise<StoredKey> {
	const { privateKey } = await jose.generateKeyPair(ALG, { modulusLength: MODULUS_LENGTH, extractable: true });
	const jwk = await jose.exportJWK(privateKey);
	const kid = kidFor(jwk);
	return { kid, jwk: { ...jwk, kid, alg: ALG, use: "sig" } };
}

export class OidcSigningKeys {
	readonly #redis: RedisProvider | null;
	readonly #logger: { logWarn(msg: string): void; logInfo(msg: string): void };
	#current: StoredKey | null = null;
	#previous: StoredKey | null = null;
	/** Sin Redis (o con Redis caído) hay una clave de proceso: sirve en desarrollo y no persiste. */
	#ephemeral = false;

	constructor(redis: RedisProvider | null, logger: { logWarn(msg: string): void; logInfo(msg: string): void }) {
		this.#redis = redis;
		this.#logger = logger;
	}

	/**
	 * Carga la clave desde Redis o la crea. Si dos nodos arrancan a la vez el `setIfAbsent` decide, y
	 * el que pierde relee la del ganador: dos claves firmando serían tokens que el otro no reconoce.
	 */
	async init(): Promise<void> {
		if (!this.#redis) {
			this.#current = await generate();
			this.#ephemeral = true;
			this.#logger.logWarn(
				"[oidc] sin Redis: la clave de firma es de este proceso y no sobrevive al reinicio. En producción, los tokens emitidos por un nodo no los valida otro."
			);
			return;
		}
		this.#previous = await this.#read(REDIS_KEYS.PREVIOUS);
		const existing = await this.#read(REDIS_KEYS.CURRENT);
		if (existing) {
			this.#current = existing;
			return;
		}
		const fresh = await generate();
		// Sin TTL: una clave de firma no vence sola.
		const won = await this.#redis.setIfAbsent(REDIS_KEYS.CURRENT, keySeal.seal(JSON.stringify(fresh), this.#logger));
		this.#current = won ? fresh : ((await this.#read(REDIS_KEYS.CURRENT)) ?? fresh);
		this.#logger.logInfo(`[oidc] clave de firma ${won ? "generada" : "tomada de otro nodo"} (kid ${this.#current.kid}).`);
	}

	async #read(key: string): Promise<StoredKey | null> {
		try {
			const raw = await this.#redis?.get(key);
			const opened = keySeal.open(raw, this.#logger);
			return opened ? (JSON.parse(opened) as StoredKey) : null;
		} catch (error) {
			this.#logger.logWarn(`[oidc] no se pudo leer la clave de firma '${key}': ${(error as Error).message}`);
			return null;
		}
	}

	/** La clave con la que se firma ahora. */
	current(): SigningKey {
		if (!this.#current) throw new Error("OidcSigningKeys.init() no corrió todavía");
		return this.#current;
	}

	/** `true` si la clave es de este proceso y no está compartida entre nodos. */
	get isEphemeral(): boolean {
		return this.#ephemeral;
	}

	/**
	 * El JWKS **público**: sólo `n` y `e`, nunca `d`. Se arma campo por campo y no con un spread
	 * porque un descuido acá entrega la capacidad de firmar identidades.
	 */
	publicJwks(): { keys: jose.JWK[] } {
		const strip = (key: StoredKey | null): jose.JWK | null => {
			if (!key) return null;
			const { kty, n, e } = key.jwk;
			return { kty, n, e, kid: key.kid, alg: ALG, use: "sig" };
		};
		return { keys: [strip(this.#current), strip(this.#previous)].filter((k): k is jose.JWK => k !== null) };
	}

	/** Firma un payload con la clave actual. El `kid` viaja en el header: así el otro lado elige bien. */
	async sign(payload: jose.JWTPayload, expiresInSeconds: number): Promise<string> {
		const key = this.current();
		const privateKey = await jose.importJWK(key.jwk, ALG);
		const now = Math.floor(Date.now() / 1000);
		return new jose.SignJWT(payload)
			.setProtectedHeader({ alg: ALG, kid: key.kid, typ: "JWT" })
			.setIssuedAt(now)
			.setExpirationTime(now + expiresInSeconds)
			.setJti(randomUUID())
			.sign(privateKey);
	}

	/**
	 * Verifica un token emitido por este proveedor, probando la clave actual y la anterior.
	 * Lo usa `/userinfo`, que es el único endpoint propio que recibe de vuelta lo que emitió.
	 */
	async verify(token: string, issuer: string): Promise<jose.JWTPayload | null> {
		for (const key of [this.#current, this.#previous]) {
			if (!key) continue;
			try {
				const publicKey = await jose.importJWK({ kty: key.jwk.kty, n: key.jwk.n, e: key.jwk.e }, ALG);
				const { payload } = await jose.jwtVerify(token, publicKey, { issuer });
				return payload;
			} catch {
				// Probar con la siguiente: que la actual no valide es lo esperado tras una rotación.
			}
		}
		return null;
	}

	/** Mueve la actual a anterior y genera una nueva. Los tokens en vuelo siguen validando por `kid`. */
	async rotate(): Promise<void> {
		if (!this.#redis || !this.#current) return;
		const fresh = await generate();
		await this.#redis.set(REDIS_KEYS.PREVIOUS, keySeal.seal(JSON.stringify(this.#current), this.#logger));
		await this.#redis.set(REDIS_KEYS.CURRENT, keySeal.seal(JSON.stringify(fresh), this.#logger));
		this.#previous = this.#current;
		this.#current = fresh;
		this.#logger.logInfo(`[oidc] clave de firma rotada (kid ${fresh.kid}).`);
	}
}
