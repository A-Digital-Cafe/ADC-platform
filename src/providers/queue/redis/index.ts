import { RedisClient } from "bun";
import { BaseProvider, ProviderType } from "../../BaseProvider.js";
import { Logger } from "../../../utils/logger/Logger.js";

/**
 * Configuración del RedisProvider
 */
interface RedisProviderConfig {
	host?: string;
	port?: number;
	password?: string;
	db?: number;
	keyPrefix?: string;
	/** Deadline por comando en ms. `0` lo desactiva (sólo queda el rechazo inmediato del socket caído). */
	commandTimeoutMs?: number;
}

/** Estado del corta-circuitos. Vive en el pool: la salud es del socket físico, no de la instancia. */
interface BreakerState {
	failures: number;
	openUntil: number;
}

interface SharedRedisEntry {
	client: RedisClient;
	refCount: number;
	breaker: BreakerState;
}

// El kernel recarga este módulo con cache-busting (?v=timestamp) al crear cada
// instancia, así que anclamos el pool compartido a globalThis para que dos
// providers que apunten al mismo host+port+auth+db reutilicen el mismo socket.
// El keyPrefix se mantiene por-instancia (es lógica de cliente, no de conexión).
const GLOBAL_KEY = Symbol.for("adc.redis.sharedPools");
const SHARED_POOLS: Map<string, SharedRedisEntry> = ((globalThis as any)[GLOBAL_KEY] ??= new Map<string, SharedRedisEntry>());

/**
 * Reconexión del cliente de Bun. El default de `maxRetries` es 10 y **se agota**: cuando eso pasa
 * el cliente queda muerto DENTRO del pool compartido, así que toda instancia que comparta esa
 * clave física —y toda la que llegue después— recibe un cliente inservible sin que nada avise.
 * Redis vuelve solo de un reinicio o de un failover de VIP; lo que no vuelve es el provider si
 * dejó de intentar. El techo alto es, en la práctica, "seguí intentando".
 *
 * `enableOfflineQueue: false` es lo que evita que una caída de Redis cuelgue la plataforma entera:
 * con la cola (el default) un comando emitido con el socket caído **no falla, queda encolado y su
 * promesa no se resuelve nunca**, así que un `await redis.*` dentro de una request —el rate limit
 * lo está, para todos los endpoints— deja la respuesta colgada hasta que el cliente se rinde.
 * Medido en Bun 1.3.14 contra un puerto muerto: con cola sigue pendiente a los 5s, sin cola rechaza
 * en 1ms. `autoReconnect` recupera el socket igual por su cuenta (verificado cortando la conexión:
 * vuelve solo, sin que ningún comando lo dispare), así que apagarla no cuesta disponibilidad.
 *
 * Precio a pagar: durante el corte los comandos rechazan en vez de esperar. Quien puede degradar lo
 * hace en su call site (el rate limit cae a un contador en memoria, la caché de permisos va a
 * Mongo); quien no puede, falla — que es lo correcto para un login o un 2FA.
 */
const RECONNECT_OPTIONS = { autoReconnect: true, maxRetries: 1_000_000, enableOfflineQueue: false } as const;

/**
 * Deadline por comando. La cola apagada cubre "socket caído", no "socket vivo pero atascado"
 * (un BGSAVE largo, una red que traga paquetes): ahí la promesa queda pendiente igual.
 */
const DEFAULT_COMMAND_TIMEOUT_MS = 1_000;
/** Fallos seguidos que abren el corta-circuitos, para no pagar el deadline en cada request de un corte largo. */
const BREAKER_THRESHOLD = 5;
const BREAKER_OPEN_MS = 3_000;
/**
 * Plazo del `connect()` inicial. Contra un Redis caído esa promesa **no vuelve nunca** (medido:
 * `autoReconnect` reintenta para siempre y no respeta `connectionTimeout`), y como se espera durante
 * el arranque del provider, sin este plazo una caída de Redis colgaba el boot del kernel entero.
 */
const CONNECT_DEADLINE_MS = 5_000;

/** `true` si la promesa se resolvió dentro del plazo; `false` si venció (la promesa sigue viva). */
async function raceDeadline(promise: Promise<unknown>, ms: number): Promise<boolean> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise.then(
				() => true,
				() => false
			),
			new Promise<boolean>((resolve) => {
				timer = setTimeout(() => resolve(false), ms);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

function buildRedisUrl(cfg: RedisProviderConfig): { url: string; physicalKey: string } {
	const { host, port, password, db } = cfg;
	const auth = password ? `:${password}@` : "";
	const dbSuffix = db ? `/${db}` : "";
	const url = `redis://${auth}${host}:${port}${dbSuffix}`;
	// La clave física es la misma URL; incluye credenciales por seguridad.
	return { url, physicalKey: url };
}

/**
 * INCR + EXPIRE en una sola ida al servidor. Fija el TTL al crear la clave y, además,
 * **repara** claves que hayan quedado sin TTL (`TTL < 0`) por un corte entre ambos comandos.
 */
const INCR_WITH_TTL_SCRIPT =
	"local c = redis.call('INCR', KEYS[1]) " +
	"if c == 1 or redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end " +
	"return c";

/**
 * RedisProvider - Cliente Redis nativo para Bun.
 *
 * Pool físico COMPARTIDO entre instancias: dos providers con el mismo
 * host+port+password+db reutilizan la misma conexión TCP. El `keyPrefix` sigue
 * siendo por-instancia. Refcount cierra el socket sólo cuando la última
 * instancia se detiene.
 */
export default class RedisProvider extends BaseProvider {
	public readonly name = "redis";
	public readonly type = ProviderType.QUEUE_PROVIDER;

	#client: RedisClient | null = null;
	#physicalKey: string | null = null;
	#breaker: BreakerState | null = null;
	readonly #config: RedisProviderConfig;
	readonly #commandTimeoutMs: number;

	constructor(config?: RedisProviderConfig) {
		super();
		// Usamos Bun.env para acceso nativo y rápido a variables de entorno
		this.#config = {
			host: config?.host || Bun.env.REDIS_HOST || "localhost",
			port: config?.port || Number.parseInt(Bun.env.REDIS_PORT || "6380", 10),
			password: config?.password || Bun.env.REDIS_PASSWORD || undefined,
			db: config?.db || Number.parseInt(Bun.env.REDIS_DB || "0", 10),
			keyPrefix: config?.keyPrefix || "adc:",
			commandTimeoutMs: config?.commandTimeoutMs,
		};
		// La cadena vacía se descarta antes de convertir: `Number("")` es 0, y un
		// `${REDIS_COMMAND_TIMEOUT_MS:-}` sin valor apagaría el deadline sin que nadie lo pidiera.
		const raw = this.#config.commandTimeoutMs ?? Bun.env.REDIS_COMMAND_TIMEOUT_MS;
		const declared = raw === "" || raw === undefined ? Number.NaN : Number(raw);
		this.#commandTimeoutMs = Number.isFinite(declared) && declared >= 0 ? declared : DEFAULT_COMMAND_TIMEOUT_MS;
	}

	/**
	 * Envoltorio de TODO comando: corta-circuitos + deadline.
	 *
	 * El rechazo tardío del comando original (llega cuando el socket se entera del corte, después de
	 * que ganó el deadline) se silencia a propósito: sin `catch` vuela como `unhandledRejection` y
	 * Bun tumba el proceso.
	 */
	async #exec<T>(op: () => Promise<T>): Promise<T> {
		const breaker = this.#breaker;
		if (breaker && breaker.openUntil > Date.now()) {
			throw new Error(`Redis no disponible (${this.#config.host}:${this.#config.port}): corta-circuitos abierto`);
		}

		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			const command = op();
			if (this.#commandTimeoutMs <= 0) return await command;
			command.catch(() => {
				/* ver docstring */
			});
			const result = await Promise.race([
				command,
				new Promise<never>((_, reject) => {
					timer = setTimeout(() => reject(new Error(`Redis no respondió en ${this.#commandTimeoutMs}ms`)), this.#commandTimeoutMs);
				}),
			]);
			if (breaker) breaker.failures = 0;
			return result;
		} catch (err) {
			if (breaker && ++breaker.failures >= BREAKER_THRESHOLD) {
				breaker.failures = 0;
				breaker.openUntil = Date.now() + BREAKER_OPEN_MS;
			}
			throw err;
		} finally {
			clearTimeout(timer);
		}
	}

	get client(): RedisClient {
		if (!this.#client) throw new Error("RedisProvider no está inicializado");

		return this.#client;
	}

	async #acquire(physicalKey: string, url: string): Promise<RedisClient> {
		let entry = SHARED_POOLS.get(physicalKey);

		if (!entry) {
			const client = new RedisClient(url, RECONNECT_OPTIONS);
			// Logger estático y no `this.logger`: los callbacks son del SOCKET, que sobrevive a la
			// instancia que lo abrió (refCount). Atados a `this`, una caída de Redis se seguiría
			// reportando con el logger de un provider ya detenido.
			const where = `${this.#config.host}:${this.#config.port}`;
			client.onclose = (msg) => {
				// A nivel warn, no debug: perder Redis apaga rate limit, sesiones, jobs y los leases
				// que reparten el trabajo entre nodos. Es lo último que conviene que sea invisible.
				Logger.warn(`[RedisProvider] Conexión perdida (${where}): ${msg.message}`);
			};
			client.onconnect = () => {
				Logger.ok(`[RedisProvider] Conectado (${where})`);
			};

			// `connect()` explícito y no un `ping()` pelado: con la cola offline apagada el PRIMER
			// comando de un cliente recién construido rechaza ("Connection is closed"), porque la
			// conexión se abre perezosamente. Y ya valida el handshake completo (AUTH incluida), así
			// que el ping de comprobación sobra.
			//
			// Se distingue rechazo de plazo vencido: un rechazo es configuración rota (contraseña,
			// host) y tiene que fallar fuerte; un plazo vencido es "Redis todavía no está", y ahí se
			// arranca degradado — `autoReconnect` conecta solo en cuanto aparece (verificado) y hasta
			// entonces los comandos rechazan rápido en vez de colgarse.
			const connecting = client.connect();
			let failure: any = null;
			connecting.catch((err: any) => {
				failure = err;
			});

			if (!(await raceDeadline(connecting, CONNECT_DEADLINE_MS))) {
				if (failure) {
					this.logger.logError(`Error conectando a Redis: ${failure.message}`);
					try {
						client.close();
					} catch {
						/* ignore */
					}
					throw failure;
				}
				this.logger.logWarn(
					`RedisProvider arranca degradado (${this.#config.host}:${this.#config.port} no respondió en ${CONNECT_DEADLINE_MS}ms): ` +
						"los comandos fallarán rápido hasta que reconecte"
				);
			}

			entry = { client, refCount: 0, breaker: { failures: 0, openUntil: 0 } };
			SHARED_POOLS.set(physicalKey, entry);
			this.logger.logOk(`RedisProvider pool abierto (${this.#config.host}:${this.#config.port})`);
		}

		entry.refCount++;
		this.#breaker = entry.breaker;
		return entry.client;
	}

	async #release(physicalKey: string): Promise<void> {
		const entry = SHARED_POOLS.get(physicalKey);
		if (!entry) return;

		entry.refCount--;
		if (entry.refCount > 0) return;

		try {
			entry.client.close();
		} catch (err: any) {
			this.logger.logError(`Error cerrando cliente Redis: ${err.message}`);
		} finally {
			SHARED_POOLS.delete(physicalKey);
			// La clave física ES la URL con credenciales: se loguea host:port, nunca la clave.
			this.logger.logOk(`RedisProvider pool cerrado (${this.#config.host}:${this.#config.port})`);
		}
	}

	async start(kernelKey: symbol): Promise<void> {
		await super.start(kernelKey);

		const { url, physicalKey } = buildRedisUrl(this.#config);
		this.#physicalKey = physicalKey;
		this.#client = await this.#acquire(physicalKey, url);

		this.logger.logOk(`RedisProvider iniciado (${this.#config.host}:${this.#config.port}, refCount compartido)`);
	}

	async stop(kernelKey: symbol): Promise<void> {
		await super.stop(kernelKey);
		if (this.#physicalKey) {
			const key = this.#physicalKey;
			this.#physicalKey = null;
			this.#client = null;
			this.#breaker = null;
			await this.#release(key);
		}
	}

	// === Operaciones básicas ===
	async get(key: string): Promise<string | null> {
		return this.#exec(() => this.client.get(this._k(key)));
	}

	async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
		const finalKey = this._k(key);
		// Bun soporta argumentos estándar de Redis
		if (ttlSeconds) await this.#exec(() => this.client.set(finalKey, value, "EX", ttlSeconds));
		else await this.#exec(() => this.client.set(finalKey, value));
	}

	/**
	 * `SET key value NX [EX <ttl>]`: escribe **sólo** si la clave no existe, en una única operación
	 * del servidor. `exists()` + `setex()` no es equivalente (dos viajes, con carrera entre medio).
	 *
	 * Sin `ttlSeconds` la clave **no vence**, que es lo que necesita cualquier valor que se crea una
	 * vez y tiene que durar (la clave de firma del proveedor OIDC, por ejemplo) pero que igual tiene
	 * que resolver quién lo crea cuando arrancan varios nodos a la vez. Antes el TTL era obligatorio
	 * y pasar `0` fallaba con `ERR invalid expire time`, así que ese caso no tenía forma de escribirse.
	 *
	 * @returns `true` si esta llamada creó la clave; `false` si ya existía.
	 */
	async setIfAbsent(key: string, value: string, ttlSeconds?: number): Promise<boolean> {
		const finalKey = this._k(key);
		const result = await (ttlSeconds && ttlSeconds > 0
			? this.#exec(() => this.client.set(finalKey, value, "NX", "EX", String(ttlSeconds)))
			: this.#exec(() => this.client.set(finalKey, value, "NX")));
		return result === "OK";
	}

	async del(key: string): Promise<void> {
		await this.#exec(() => this.client.del(this._k(key)));
	}

	async exists(key: string): Promise<boolean> {
		const result = await this.#exec(() => this.client.exists(this._k(key)));
		return result;
	}

	// === Operaciones con TTL ===
	async setex(key: string, ttlSeconds: number, value: string): Promise<void> {
		await this.#exec(() => this.client.setex(this._k(key), ttlSeconds, value));
	}

	async ttl(key: string): Promise<number> {
		return this.#exec(() => this.client.ttl(this._k(key)));
	}

	async expire(key: string, ttlSeconds: number): Promise<boolean> {
		const result = await this.#exec(() => this.client.expire(this._k(key), ttlSeconds));
		return result === 1;
	}

	// === Operaciones con hash ===
	async hget(key: string, field: string): Promise<string | null> {
		return this.#exec(() => this.client.hget(this._k(key), field));
	}

	async hset(key: string, field: string, value: string): Promise<void> {
		// hset devuelve el número de campos añadidos, pero la interfaz pide void
		await this.#exec(() => this.client.hset(this._k(key), field, value));
	}

	async hdel(key: string, field: string): Promise<void> {
		await this.#exec(() => this.client.hdel(this._k(key), field));
	}

	async hgetall(key: string): Promise<Record<string, string>> {
		return this.#exec(() => this.client.hgetall(this._k(key)));
	}

	async hincrby(key: string, field: string, increment: number): Promise<number> {
		return this.#exec(() => this.client.hincrby(this._k(key), field, increment));
	}

	// === Operaciones con sets ===
	async sadd(key: string, ...members: string[]): Promise<number> {
		return this.#exec(() => this.client.sadd(this._k(key), ...members));
	}

	async srem(key: string, ...members: string[]): Promise<number> {
		return this.#exec(() => this.client.srem(this._k(key), ...members));
	}

	async smembers(key: string): Promise<string[]> {
		return this.#exec(() => this.client.smembers(this._k(key)));
	}

	async sismember(key: string, member: string): Promise<boolean> {
		return await this.#exec(() => this.client.sismember(this._k(key), member));
	}

	// === Operaciones de incremento ===
	async incr(key: string): Promise<number> {
		return this.#exec(() => this.client.incr(this._k(key)));
	}

	async incrby(key: string, increment: number): Promise<number> {
		return this.#exec(() => this.client.incrby(this._k(key), increment));
	}

	/**
	 * Contador de ventana fija: incrementa y garantiza el TTL en **una sola operación atómica**.
	 *
	 * Con el par no atómico `incr()` + `if (count === 1) expire()`, cualquier corte entre las dos
	 * llamadas (caída de la conexión, hot-reload del módulo, `expire` que devuelve false) deja la
	 * clave sin TTL — y como el contador ya nunca vuelve a valer 1, el `expire` no se reintenta
	 * jamás: la ventana no cierra nunca y el contador crece para siempre. Con `appendonly` la
	 * clave envenenada sobrevive incluso al reinicio del contenedor.
	 *
	 * El script además **repara** claves que hayan quedado sin TTL por ese camino.
	 *
	 * @returns el valor del contador después del incremento.
	 */
	async incrWithTtl(key: string, ttlSeconds: number): Promise<number> {
		const ttl = String(Math.max(1, Math.floor(ttlSeconds)));
		const count = await this.#exec(() => this.client.send("EVAL", [INCR_WITH_TTL_SCRIPT, "1", this._k(key), ttl]));
		return Number(count);
	}

	// === Operaciones de patrón ===
	async keys(pattern: string): Promise<string[]> {
		// Nota: keys usa el prefijo si se lo aplicamos
		return this.#exec(() => this.client.keys(this._k(pattern)));
	}

	async scan(cursor: number, pattern: string, count: number = 100): Promise<[string, string[]]> {
		return await this.#exec(() => this.client.scan(cursor.toString(), "MATCH", this._k(pattern), "COUNT", count));
	}

	/**
	 * Helper privado para aplicar el prefijo manualmente,
	 * ya que el cliente nativo de Bun podría no soportarlo transparentemente en config todavía.
	 */
	private _k(key: string): string {
		if (!this.#config.keyPrefix) return key;
		return `${this.#config.keyPrefix}${key}`;
	}
}
