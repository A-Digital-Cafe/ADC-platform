import { randomBytes } from "node:crypto";
import { createAtRestSealer, type EnvelopeLogger } from "@common/utils/at-rest-envelope.ts";
import { sha256Bytes } from "@common/utils/crypto.ts";
import type RedisProvider from "../../../../../providers/queue/redis/index.js";

/**
 * Sellado en reposo de las claves de sesión.
 *
 * Estas claves cifran y autentican **todos** los access tokens (JWE) y persisten en un Redis
 * sin autenticación: en claro, quien lea esa base descifra cualquier sesión y quien la escriba
 * **fabrica sesiones nuevas** haciéndose pasar por cualquier usuario, sin necesitar su
 * contraseña. Es estrictamente peor que escalar permisos dentro de una sesión ajena, y por eso
 * el sobre acá no es opcional.
 *
 * Cambiar la etiqueta —o la master key— invalida las sesiones vivas y obliga a re-loguear.
 */
const keySeal = createAtRestSealer("adc:session-keys");

/** Claves Redis para persistencia */
const REDIS_KEYS = {
	CURRENT: "session:keys:current",
	PREVIOUS: "session:keys:previous",
	ROTATED_AT: "session:keys:rotatedAt",
} as const;

/**
 * Configuración del KeyStore
 */
interface KeyStoreConfig {
	/** Intervalo de rotación en ms (default: 24h) */
	rotationInterval: number;
	/** Longitud de las claves en bytes (default: 32) */
	keyLength: number;
	/** Claves iniciales (opcional, para fallback) */
	initialKeys?: {
		current: string;
		previous?: string;
	};
	/** Redis provider para persistencia (opcional) */
	redis?: RedisProvider;
	/** Logger para los avisos del sellado en reposo (opcional). */
	logger?: EnvelopeLogger;
}

/**
 * Par de claves actual y anterior
 */
interface KeyPair {
	current: Uint8Array;
	previous: Uint8Array | null;
	currentRaw: string;
	previousRaw: string | null;
	rotatedAt: number;
}

/**
 * Callback para notificar rotación de claves
 */
type KeyRotationCallback = (keys: KeyPair) => void | Promise<void>;

/**
 * KeyStore - Gestión de secretos con rotación automática
 *
 * Soporta persistencia en Redis para compartir claves entre instancias.
 * Si Redis no está disponible, funciona con almacenamiento en memoria.
 */
export class KeyStore {
	#currentKey: string;
	#previousKey: string | null = null;
	#currentKeyBytes: Uint8Array;
	#previousKeyBytes: Uint8Array | null = null;
	#rotatedAt: number;
	readonly #rotationInterval: number;
	readonly #keyLength: number;
	#rotationTimer: ReturnType<typeof setInterval> | null = null;
	readonly #rotationCallbacks: KeyRotationCallback[] = [];
	readonly #redis: RedisProvider | null = null;
	readonly #logger: EnvelopeLogger | undefined;

	constructor(config: KeyStoreConfig) {
		this.#rotationInterval = config.rotationInterval;
		this.#keyLength = config.keyLength;
		this.#rotatedAt = Date.now();
		this.#redis = config.redis || null;
		this.#logger = config.logger;

		// Inicializar con claves proporcionadas o generar nuevas
		if (config.initialKeys?.current) {
			this.#currentKey = config.initialKeys.current;
			this.#previousKey = config.initialKeys.previous || null;
		} else {
			this.#currentKey = this.#generateKey();
			this.#previousKey = null;
		}

		this.#currentKeyBytes = this.#stringToKey(this.#currentKey);
		this.#previousKeyBytes = this.#previousKey ? this.#stringToKey(this.#previousKey) : null;
	}

	/**
	 * Inicializa el KeyStore cargando claves desde Redis si está disponible
	 */
	async init(): Promise<void> {
		if (!this.#redis) return;

		try {
			const [sealedCurrent, sealedPrevious, rotatedAt] = await Promise.all([
				this.#redis.get(REDIS_KEYS.CURRENT),
				this.#redis.get(REDIS_KEYS.PREVIOUS),
				this.#redis.get(REDIS_KEYS.ROTATED_AT),
			]);

			const current = keySeal.open(sealedCurrent, this.#logger);

			if (current) {
				this.#currentKey = current;
				this.#currentKeyBytes = this.#stringToKey(current);
				this.#previousKey = keySeal.open(sealedPrevious, this.#logger);
				this.#previousKeyBytes = this.#previousKey ? this.#stringToKey(this.#previousKey) : null;
				this.#rotatedAt = rotatedAt ? Number.parseInt(rotatedAt, 10) : Date.now();
				return;
			}

			// Sin clave utilizable: o no había ninguna, o lo guardado no abre (valor previo al
			// cifrado, manipulado, o master key distinta). En ambos casos se persisten las de
			// memoria, que además pisa el valor inservible. El costo es que las sesiones vivas
			// dejan de validar y hay que volver a entrar; aceptarlo crudo no es una opción,
			// porque justamente es lo que permitiría plantar una clave elegida por el atacante.
			if (sealedCurrent) {
				this.#logger?.logWarn(
					"[KeyStore] la clave de sesión guardada no se pudo abrir: se genera una nueva y se invalidan las sesiones vivas."
				);
			}
			await this.#persistKeys();
		} catch {
			// Si Redis falla, usar claves en memoria
		}
	}

	/**
	 * Inicia la rotación automática
	 */
	startRotation(): void {
		if (this.#rotationTimer) return;

		this.#rotationTimer = setInterval(() => {
			this.#rotate();
		}, this.#rotationInterval);
	}

	/**
	 * Detiene la rotación automática
	 */
	stopRotation(): void {
		if (this.#rotationTimer) {
			clearInterval(this.#rotationTimer);
			this.#rotationTimer = null;
		}
	}

	/**
	 * Ejecuta una rotación manual de claves
	 */
	async #rotate(): Promise<void> {
		this.#previousKey = this.#currentKey;
		this.#previousKeyBytes = this.#currentKeyBytes;
		this.#currentKey = this.#generateKey();
		this.#currentKeyBytes = this.#stringToKey(this.#currentKey);
		this.#rotatedAt = Date.now();

		// Persistir en Redis
		await this.#persistKeys();

		// Notificar a los listeners
		const keyPair = this.getKeyPair();
		for (const callback of this.#rotationCallbacks) {
			try {
				await callback(keyPair);
			} catch {
				// Los errores en callbacks no deben detener la rotación
			}
		}
	}

	/**
	 * Persiste las claves en Redis
	 */
	async #persistKeys(): Promise<void> {
		if (!this.#redis) return;

		try {
			await Promise.all([
				this.#redis.set(REDIS_KEYS.CURRENT, keySeal.seal(this.#currentKey, this.#logger)),
				this.#previousKey
					? this.#redis.set(REDIS_KEYS.PREVIOUS, keySeal.seal(this.#previousKey, this.#logger))
					: this.#redis.del(REDIS_KEYS.PREVIOUS),
				this.#redis.set(REDIS_KEYS.ROTATED_AT, this.#rotatedAt.toString()),
			]);
		} catch {
			// Silenciar errores de persistencia
		}
	}

	/**
	 * Registra un callback para cuando se rotan las claves
	 */
	onRotation(callback: KeyRotationCallback): void {
		this.#rotationCallbacks.push(callback);
	}

	/**
	 * Obtiene la clave actual como bytes
	 */
	getCurrentKeyBytes(): Uint8Array {
		return this.#currentKeyBytes;
	}

	/**
	 * Obtiene la clave anterior como bytes (si existe)
	 */
	getPreviousKeyBytes(): Uint8Array | null {
		return this.#previousKeyBytes;
	}

	/**
	 * Obtiene el par de claves completo
	 */
	getKeyPair(): KeyPair {
		return {
			current: this.#currentKeyBytes,
			previous: this.#previousKeyBytes,
			currentRaw: this.#currentKey,
			previousRaw: this.#previousKey,
			rotatedAt: this.#rotatedAt,
		};
	}

	/**
	 * Tiempo restante hasta la próxima rotación en ms
	 */
	getTimeUntilRotation(): number {
		const elapsed = Date.now() - this.#rotatedAt;
		return Math.max(0, this.#rotationInterval - elapsed);
	}

	/**
	 * Genera una clave aleatoria segura
	 */
	#generateKey(): string {
		return randomBytes(this.#keyLength).toString("base64");
	}

	/**
	 * Deriva los 32 bytes que pide A256GCM a partir del secreto, sea cual sea su largo.
	 * Rellenar/truncar a 32 **caracteres** descartaría entropía del secreto real (32 bytes en
	 * base64 son 44 caracteres); el hash no agrega entropía pero tampoco la tira.
	 */
	#stringToKey(key: string): Uint8Array {
		return sha256Bytes(key);
	}
}
