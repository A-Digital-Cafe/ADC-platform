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
	/**
	 * Gate de exclusión para la rotación (opcional). Las claves de Redis son COMPARTIDAS entre
	 * nodos, así que rotar tiene que pasar por uno solo; el KeyStore no es un módulo del kernel y
	 * no puede elegirlo, así que lo recibe ya resuelto y sigue sin saber que existen los leases.
	 * Si el gate decide que este nodo no rota, no invoca a `fn`. Sin gate rota siempre: con un
	 * solo nodo negarse sería peor que la rotación duplicada que evita.
	 */
	runExclusive?: (fn: () => Promise<void>) => Promise<void>;
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
 * Qué pasó al intentar adoptar el par persistido. `absent` (todavía no hay nada guardado) y
 * `unusable` (hay algo pero no abre) van separados porque sólo el segundo es una anomalía.
 */
type AdoptOutcome = "adopted" | "unusable" | "absent";

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
	readonly #runExclusive: (fn: () => Promise<void>) => Promise<void>;

	constructor(config: KeyStoreConfig) {
		this.#rotationInterval = config.rotationInterval;
		this.#keyLength = config.keyLength;
		this.#rotatedAt = Date.now();
		this.#redis = config.redis || null;
		this.#logger = config.logger;
		this.#runExclusive = config.runExclusive || ((fn) => fn());

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
			const outcome = await this.#adoptPersistedKeys();
			if (outcome === "adopted") return;

			// Sin clave utilizable: o no había ninguna, o lo guardado no abre (valor previo al
			// cifrado, manipulado, o master key distinta). En ambos casos se persisten las de
			// memoria, que además pisa el valor inservible. El costo es que las sesiones vivas
			// dejan de validar y hay que volver a entrar; aceptarlo crudo no es una opción,
			// porque justamente es lo que permitiría plantar una clave elegida por el atacante.
			if (outcome === "unusable") {
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
	 * Sincroniza el par en memoria con el que está persistido. Sólo LEE: un nodo con la memoria
	 * atrasada no puede pisar desde acá el par que otro acabe de rotar; persistir es siempre un
	 * paso explícito de quien llama.
	 */
	async #adoptPersistedKeys(): Promise<AdoptOutcome> {
		if (!this.#redis) return "absent";

		const [sealedCurrent, sealedPrevious, rotatedAt] = await Promise.all([
			this.#redis.get(REDIS_KEYS.CURRENT),
			this.#redis.get(REDIS_KEYS.PREVIOUS),
			this.#redis.get(REDIS_KEYS.ROTATED_AT),
		]);

		const current = keySeal.open(sealedCurrent, this.#logger);
		if (!current) return sealedCurrent ? "unusable" : "absent";

		this.#currentKey = current;
		this.#currentKeyBytes = this.#stringToKey(current);
		this.#previousKey = keySeal.open(sealedPrevious, this.#logger);
		this.#previousKeyBytes = this.#previousKey ? this.#stringToKey(this.#previousKey) : null;
		this.#rotatedAt = rotatedAt ? Number.parseInt(rotatedAt, 10) : Date.now();
		return "adopted";
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
	 * Turno de rotación: rota en el nodo que pase el gate y, en los demás, adopta lo que ese nodo
	 * dejó persistido.
	 *
	 * Rotar en todos a la vez rompía el par: el segundo nodo toma como `previous` su propia
	 * `current`, con lo que la clave recién emitida por el primero queda fuera de las dos válidas y
	 * las sesiones vivas se caen sin aviso. Pero quedarse sin hacer nada tampoco alcanza: un nodo
	 * que nunca vuelve a leer Redis se queda con un par viejo para siempre y rechaza los tokens que
	 * emite el que sí rota. Por eso el turno perdido igual sincroniza.
	 */
	async #rotate(): Promise<void> {
		let rotated = false;
		try {
			await this.#runExclusive(async () => {
				rotated = true;
				await this.#rotateKeyPair();
			});
			if (!rotated) await this.#adoptPersistedKeys();
		} catch (err: any) {
			// El turno se pierde y lo retoma el siguiente. Nadie espera esta promesa (la dispara el
			// `setInterval`), así que dejarla romper sería una rejection sin dueño; y rotar a ciegas
			// tras un Redis que parpadeó es justamente lo que parte el par.
			this.#logger?.logWarn(`[KeyStore] el turno de rotación de claves falló: ${err?.message || err}`);
		}
	}

	/** Genera el par nuevo, lo persiste y avisa a los listeners. Sólo lo corre el nodo que rota. */
	async #rotateKeyPair(): Promise<void> {
		// Rotar sobre lo persistido y no sobre memoria: si en el turno anterior rotó otro nodo, la
		// `current` de éste está atrasada y usarla como `previous` dejaría afuera del par a la clave
		// con la que se emitieron las sesiones que hoy están vivas.
		const outcome = await this.#adoptPersistedKeys();

		// Otro nodo ya rotó dentro de este intervalo: su turno cuenta por el de todos. Sin esto, los
		// timers desfasados de N nodos rotarían N veces por intervalo y cada rotación acorta la
		// ventana en la que la clave anterior sigue validando tokens ya emitidos.
		if (outcome === "adopted" && Date.now() - this.#rotatedAt < this.#rotationInterval) return;

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
