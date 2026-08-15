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
}

interface SharedRedisEntry {
	client: RedisClient;
	refCount: number;
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
 */
const RECONNECT_OPTIONS = { autoReconnect: true, maxRetries: 1_000_000, enableOfflineQueue: true } as const;

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
	readonly #config: RedisProviderConfig;

	constructor(config?: RedisProviderConfig) {
		super();
		// Usamos Bun.env para acceso nativo y rápido a variables de entorno
		this.#config = {
			host: config?.host || Bun.env.REDIS_HOST || "localhost",
			port: config?.port || Number.parseInt(Bun.env.REDIS_PORT || "6380", 10),
			password: config?.password || Bun.env.REDIS_PASSWORD || undefined,
			db: config?.db || Number.parseInt(Bun.env.REDIS_DB || "0", 10),
			keyPrefix: config?.keyPrefix || "adc:",
		};
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

			try {
				await client.ping();
			} catch (err: any) {
				this.logger.logError(`Error conectando a Redis: ${err.message}`);
				try {
					client.close();
				} catch {
					/* ignore */
				}
				throw err;
			}

			entry = { client, refCount: 0 };
			SHARED_POOLS.set(physicalKey, entry);
			this.logger.logOk(`RedisProvider pool abierto (${this.#config.host}:${this.#config.port})`);
		}

		entry.refCount++;
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
			await this.#release(key);
		}
	}

	// === Operaciones básicas ===
	async get(key: string): Promise<string | null> {
		return this.client.get(this._k(key));
	}

	async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
		const finalKey = this._k(key);
		if (ttlSeconds)
			// Bun soporta argumentos estándar de Redis
			await this.client.set(finalKey, value, "EX", ttlSeconds);
		else await this.client.set(finalKey, value);
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
		const result = ttlSeconds && ttlSeconds > 0
			? await this.client.set(finalKey, value, "NX", "EX", String(ttlSeconds))
			: await this.client.set(finalKey, value, "NX");
		return result === "OK";
	}

	async del(key: string): Promise<void> {
		await this.client.del(this._k(key));
	}

	async exists(key: string): Promise<boolean> {
		const result = await this.client.exists(this._k(key));
		return result;
	}

	// === Operaciones con TTL ===
	async setex(key: string, ttlSeconds: number, value: string): Promise<void> {
		await this.client.setex(this._k(key), ttlSeconds, value);
	}

	async ttl(key: string): Promise<number> {
		return this.client.ttl(this._k(key));
	}

	async expire(key: string, ttlSeconds: number): Promise<boolean> {
		const result = await this.client.expire(this._k(key), ttlSeconds);
		return result === 1;
	}

	// === Operaciones con hash ===
	async hget(key: string, field: string): Promise<string | null> {
		return this.client.hget(this._k(key), field);
	}

	async hset(key: string, field: string, value: string): Promise<void> {
		// hset devuelve el número de campos añadidos, pero la interfaz pide void
		await this.client.hset(this._k(key), field, value);
	}

	async hdel(key: string, field: string): Promise<void> {
		await this.client.hdel(this._k(key), field);
	}

	async hgetall(key: string): Promise<Record<string, string>> {
		return this.client.hgetall(this._k(key));
	}

	async hincrby(key: string, field: string, increment: number): Promise<number> {
		return this.client.hincrby(this._k(key), field, increment);
	}

	// === Operaciones con sets ===
	async sadd(key: string, ...members: string[]): Promise<number> {
		return this.client.sadd(this._k(key), ...members);
	}

	async srem(key: string, ...members: string[]): Promise<number> {
		return this.client.srem(this._k(key), ...members);
	}

	async smembers(key: string): Promise<string[]> {
		return this.client.smembers(this._k(key));
	}

	async sismember(key: string, member: string): Promise<boolean> {
		return await this.client.sismember(this._k(key), member);
	}

	// === Operaciones de incremento ===
	async incr(key: string): Promise<number> {
		return this.client.incr(this._k(key));
	}

	async incrby(key: string, increment: number): Promise<number> {
		return this.client.incrby(this._k(key), increment);
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
		const count = await this.client.send("EVAL", [INCR_WITH_TTL_SCRIPT, "1", this._k(key), ttl]);
		return Number(count);
	}

	// === Operaciones de patrón ===
	async keys(pattern: string): Promise<string[]> {
		// Nota: keys usa el prefijo si se lo aplicamos
		return this.client.keys(this._k(pattern));
	}

	async scan(cursor: number, pattern: string, count: number = 100): Promise<[string, string[]]> {
		return await this.client.scan(cursor.toString(), "MATCH", this._k(pattern), "COUNT", count);
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
