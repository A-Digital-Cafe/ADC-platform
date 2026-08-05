import mongoose, { Connection, Model, Schema } from "mongoose";
import { BaseProvider, ProviderType } from "../../BaseProvider.js";
import { OnlyKernel } from "../../../utils/decorators/OnlyKernel.ts";
import { Logger } from "../../../utils/logger/Logger.js";
import { buildMongoUri, hasMongoUriParts, redactMongoUri, splitMongoUri, type MongoUriParts } from "./uri.js";

interface IMongoConfig {
	uri: string;
	maxRetries?: number;
	retryDelay?: number;
	connectionTimeout?: number;
	serverSelectionTimeout?: number;
	socketTimeout?: number;
	autoReconnect?: boolean;
	reconnectInterval?: number;
	/**
	 * Límites del pool. Ojo: el pool es COMPARTIDO por todos los módulos que apuntan al mismo
	 * host+credenciales, así que estos números no son "por módulo" y los fija quien abre primero.
	 */
	maxPoolSize?: number;
	minPoolSize?: number;
}

interface MultiDbStats {
	connections: Array<{
		uri: string;
		databases: string[];
		connected: boolean;
		/** Instancias de provider que hoy comparten este pool. */
		refCount: number;
		/** Límites con los que se abrió (no son por módulo: ver {@link IMongoConfig}). */
		maxPoolSize: number;
		minPoolSize: number;
		/** Sockets vivos y en uso, medidos con los eventos CMAP del driver. */
		openConnections: number;
		inUseConnections: number;
	}>;
}

/** El `MongoClient` que hay debajo de la conexión, sin importar `mongodb` (dep transitiva). */
type MongoClient = ReturnType<Connection["getClient"]>;

/** Contadores CMAP del pool físico (ver {@link attachPoolCounters}). */
interface PoolCounters {
	created: number;
	closed: number;
	checkedOut: number;
	checkedIn: number;
}

/**
 * Cómo una instancia del provider se entera de lo que le pasa al pool que comparte.
 *
 * Los listeners del pool son de la CONEXIÓN, no de quien la abrió: si capturaran `this`,
 * el `disconnected` sólo reprogramaría la reconexión de la instancia que ganó la carrera
 * de creación (y la retendría viva aunque se la detuviera), dejando a las demás sin
 * reconexión y sin `lastError`. Por eso el pool notifica a un conjunto de suscriptores.
 */
interface PoolSubscriber {
	/** El pool se cayó: cada instancia decide si reprograma su reconexión. */
	onDisconnected(): void;
	/** Error del pool: cada instancia lo guarda para su `getStats()`. */
	onError(message: string): void;
}

interface SharedPoolEntry {
	physical: Connection;
	refCount: number;
	listenersAttached: boolean;
	dbViews: Map<string, Connection>;
	/** Instancias vivas que comparten este pool (ver {@link PoolSubscriber}). */
	subscribers: Set<PoolSubscriber>;
	/** Límites reales con los que se abrió este pool, para reportarlos sin inventar. */
	maxPoolSize: number;
	minPoolSize: number;
	counters: PoolCounters;
}

// El kernel recarga el módulo con cache-busting (?v=timestamp) en cada loadProvider,
// así que cada instancia evalúa este archivo de nuevo. Anclamos el pool físico a
// globalThis para que todas las instancias (incluso tras hot-reload) compartan el
// mismo Map y se respete el refcount.
const GLOBAL_KEY = Symbol.for("adc.mongo.sharedPools");
const SHARED_POOLS: Map<string, SharedPoolEntry> = ((globalThis as any)[GLOBAL_KEY] ??= new Map<string, SharedPoolEntry>());
// Promesas en vuelo para evitar carreras: si dos instancias llaman a connect()
// en paralelo sobre el mismo physicalKey, ambas esperan la misma createConnection.
const INFLIGHT_KEY = Symbol.for("adc.mongo.sharedPools.inflight");
const INFLIGHT_POOLS: Map<string, Promise<SharedPoolEntry>> = ((globalThis as any)[INFLIGHT_KEY] ??= new Map<
	string,
	Promise<SharedPoolEntry>
>());

/**
 * Listeners del pool físico. Función de módulo y no método: así no puede capturar una
 * instancia del provider (ver {@link PoolSubscriber}). Se atan una sola vez por entry.
 */
function attachPoolListeners(entry: SharedPoolEntry, physicalKey: string): void {
	const { physical } = entry;
	const where = () => `${physical.host}:${physical.port}`;

	physical.on("connected", () => {
		Logger.ok(`[MongoProvider] Pool conectado: ${where()}`);
	});

	physical.on("disconnected", () => {
		// El entry se relee del mapa: tras un cierre por refcount ya no está y no hay a
		// quién avisar (ni a quién reconectar).
		const current = SHARED_POOLS.get(physicalKey);
		if (!current || current.refCount <= 0) return;
		Logger.warn(`[MongoProvider] Pool desconectado: ${where()}`);
		for (const subscriber of [...current.subscribers]) subscriber.onDisconnected();
	});

	physical.on("error", (error: any) => {
		Logger.error(`[MongoProvider] Error de conexión: ${error.message}`);
		for (const subscriber of [...(SHARED_POOLS.get(physicalKey)?.subscribers ?? [])]) subscriber.onError(error.message);
	});

	physical.on("reconnected", () => {
		Logger.ok(`[MongoProvider] Pool reconectado: ${where()}`);
	});
}

/**
 * Contabilidad real de sockets del pool.
 *
 * El driver emite estos eventos CMAP siempre (no hay que habilitar monitoring) y son la única
 * forma pública de saber cuántas conexiones hay abiertas: `MongoClient` no expone el tamaño de
 * su pool. En un replica set llegan de todos los servidores, así que los contadores son del
 * conjunto.
 *
 * Hay que atarlos ANTES de que el pool termine de abrir: `minPoolSize` crea sus sockets durante
 * el connect, y suscribirse después pierde esos `connectionCreated` — los `connectionClosed`
 * sí llegan todos, y el resultado es un `openConnections` que se va a negativo al cerrar.
 */
function attachPoolCounters(client: MongoClient, counters: PoolCounters): void {
	client.on("connectionCreated", () => counters.created++);
	client.on("connectionClosed", () => counters.closed++);
	client.on("connectionCheckedOut", () => counters.checkedOut++);
	client.on("connectionCheckedIn", () => counters.checkedIn++);
	// No hace falta tratar `connectionPoolCleared` (un primary que cambió, p. ej.): los sockets
	// que se descartan emiten igual su `connectionClosed`, así que los contadores se equilibran
	// solos. Ponerlos a cero ahí sería peor: los cierres posteriores dejarían `closed > created`.
}

const computePhysicalKey = splitMongoUri;

/**
 * MongoProvider - Pool físico compartido entre instancias.
 * Dos providers con el mismo host+credenciales+opts reutilizan la misma conexión TCP,
 * aunque el nombre de la DB en el pathname sea distinto (cada instancia trabaja
 * contra una vista lógica useDb()). Refcount por pool; se cierra solo cuando la
 * última instancia la libera.
 */
export default class MongoProvider extends BaseProvider {
	public readonly name = "mongo-provider";
	public readonly type = ProviderType.OBJECT_PROVIDER;

	private connection: Connection | null = null;
	private physicalKey: string | null = null;
	private dbName: string = "";
	private readonly config: IMongoConfig;
	private retryCount = 0;
	private lastError: string | undefined;
	private reconnectTimer: NodeJS.Timeout | null = null;
	private initialized = false;
	private isDisconnecting = false;

	readonly #extraPhysicalKeys: Set<string> = new Set();
	readonly #dbViewsCache: Map<string, Connection> = new Map();
	#connectPromise: Promise<void> | null = null;

	/** Cuántas veces ESTA instancia tomó cada pool (main + `getOrCreateConnection`). */
	readonly #holds: Map<string, number> = new Map();

	/** Lo que esta instancia hace cuando el pool compartido avisa (ver {@link PoolSubscriber}). */
	readonly #subscriber: PoolSubscriber = {
		onDisconnected: () => {
			if (this.isDisconnecting || !this.config.autoReconnect) return;
			this.#scheduleReconnect();
		},
		onError: (message: string) => {
			this.lastError = message;
		},
	};

	constructor(options?: any) {
		super();
		this.config = {
			uri: MongoProvider.#resolveUri(options),
			maxRetries: options?.maxRetries ?? 5,
			retryDelay: options?.retryDelay ?? 5000,
			connectionTimeout: options?.connectionTimeout ?? 10000,
			serverSelectionTimeout: options?.serverSelectionTimeout ?? 5000,
			socketTimeout: options?.socketTimeout ?? 45000,
			autoReconnect: options?.autoReconnect ?? true,
			reconnectInterval: options?.reconnectInterval ?? 10000,
			maxPoolSize: options?.maxPoolSize ?? 10,
			minPoolSize: options?.minPoolSize ?? 5,
		};
		mongoose.set("strict", true);
		mongoose.set("strictQuery", false);
	}

	/**
	 * `uri` explícita → clúster externo o `mongodb+srv`. `host` → se compone con el `db` del
	 * módulo (el caso normal). Ninguno → el default histórico, para el módulo que declara
	 * `object/mongo` sin `custom`.
	 */
	static #resolveUri(options?: MongoUriParts): string {
		if (options?.uri?.trim()) return options.uri.trim();
		if (hasMongoUriParts(options)) return buildMongoUri(options!);
		return process.env.MONGODB_URI || "mongodb://localhost:27017/adc-platform";
	}

	async #acquirePhysical(physicalKey: string): Promise<SharedPoolEntry> {
		let entry = SHARED_POOLS.get(physicalKey);

		if (!entry || entry.physical.readyState === 0) {
			// Coalescer carreras: si ya hay una creación en vuelo para este key, esperarla.
			let inflight = INFLIGHT_POOLS.get(physicalKey);
			if (!inflight) {
				inflight = (async () => {
					try {
						const maxPoolSize = this.config.maxPoolSize!;
						const minPoolSize = this.config.minPoolSize!;
						const counters: PoolCounters = { created: 0, closed: 0, checkedOut: 0, checkedIn: 0 };

						// Sin `await`: mongoose deja el `MongoClient` en la conexión antes de llamar a
						// su `connect()`, así que este es el único punto donde se puede contar desde el
						// primer socket (ver {@link attachPoolCounters}).
						const pending = mongoose.createConnection(physicalKey, {
							connectTimeoutMS: this.config.connectionTimeout,
							serverSelectionTimeoutMS: this.config.serverSelectionTimeout,
							socketTimeoutMS: this.config.socketTimeout,
							retryWrites: true,
							retryReads: true,
							maxPoolSize,
							minPoolSize,
						});
						try {
							attachPoolCounters(pending.getClient(), counters);
						} catch (error: any) {
							// El pool sirve igual; sólo se pierde la métrica.
							Logger.warn(`[MongoProvider] Sin contadores de pool para ${redactMongoUri(physicalKey)}: ${error.message}`);
						}
						const physical = await pending.asPromise();
						// Un pool caído se reemplaza, pero sus tenedores siguen existiendo: se
						// arrastran refCount y suscriptores o quedan sin reconexión y el pool
						// nuevo se cerraría al primer release de una instancia ajena.
						const stale = SHARED_POOLS.get(physicalKey);
						const fresh: SharedPoolEntry = {
							physical,
							refCount: stale?.refCount ?? 0,
							listenersAttached: false,
							dbViews: new Map(),
							subscribers: new Set(stale?.subscribers),
							maxPoolSize,
							minPoolSize,
							// Contadores del cliente nuevo: el viejo se fue con sus sockets.
							counters,
						};
						SHARED_POOLS.set(physicalKey, fresh);
						Logger.ok(`[MongoProvider] Pool físico abierto: ${physical.host}:${physical.port}`);
						return fresh;
					} finally {
						INFLIGHT_POOLS.delete(physicalKey);
					}
				})();
				INFLIGHT_POOLS.set(physicalKey, inflight);
			}
			entry = await inflight;
		}

		// El pool ya existía: sus límites los fijó quien lo abrió primero. Avisar en vez de
		// dejar que `getMultiDbStats` muestre un número que este módulo no pidió.
		if (entry.maxPoolSize !== this.config.maxPoolSize)
			Logger.warn(
				`[MongoProvider] El pool ${redactMongoUri(physicalKey)} ya estaba abierto con maxPoolSize=${entry.maxPoolSize}; ` +
					`se ignora el maxPoolSize=${this.config.maxPoolSize} de este módulo.`
			);

		entry.refCount++;
		entry.subscribers.add(this.#subscriber);
		this.#holds.set(physicalKey, (this.#holds.get(physicalKey) ?? 0) + 1);
		if (!entry.listenersAttached) {
			attachPoolListeners(entry, physicalKey);
			entry.listenersAttached = true;
		}
		return entry;
	}

	async #releasePhysical(physicalKey: string): Promise<void> {
		const entry = SHARED_POOLS.get(physicalKey);
		if (!entry) return;

		// La suscripción se corta cuando esta instancia suelta su ÚLTIMA toma del pool: una
		// sola instancia puede tenerlo dos veces (la conexión principal y una extra por
		// `getOrCreateConnection`), y cortarla en la primera la dejaría sin reconexión.
		const holds = (this.#holds.get(physicalKey) ?? 1) - 1;
		if (holds > 0) this.#holds.set(physicalKey, holds);
		else {
			this.#holds.delete(physicalKey);
			entry.subscribers.delete(this.#subscriber);
		}

		entry.refCount--;
		if (entry.refCount > 0) return;

		try {
			await entry.physical.close();
			Logger.ok(`[MongoProvider] Pool físico cerrado: ${redactMongoUri(physicalKey)}`);
		} catch (error: any) {
			Logger.error(`[MongoProvider] Error cerrando pool físico: ${error.message}`);
		} finally {
			SHARED_POOLS.delete(physicalKey);
		}
	}

	#getDbView(entry: SharedPoolEntry, dbName: string): Connection {
		const cached = entry.dbViews.get(dbName);
		if (cached) return cached;
		const view = entry.physical.useDb(dbName, { useCache: true });
		entry.dbViews.set(dbName, view);
		return view;
	}

	/**
	 * Espera a que la conexión iniciada en `start()` esté lista. No inicia ni reintenta
	 * nada por sí misma (por eso no necesita capability: no hay poder que proteger).
	 * Propaga el error si la conexión inicial agotó los reintentos.
	 */
	async whenReady(): Promise<void> {
		if (!this.#connectPromise) throw new Error("MongoProvider.whenReady: el provider aún no fue iniciado por el kernel");
		await this.#connectPromise;
	}

	async #connect(): Promise<void> {
		if (this.connection?.readyState === 1) {
			Logger.info(`[MongoProvider] Ya conectado a ${this.dbName}`);
			return;
		}

		try {
			const { physicalKey, dbName } = computePhysicalKey(this.config.uri);
			const entry = await this.#acquirePhysical(physicalKey);

			this.physicalKey = physicalKey;
			this.dbName = dbName;
			this.connection = this.#getDbView(entry, dbName);

			this.retryCount = 0;
			this.lastError = undefined;

			Logger.ok(`[MongoProvider] Conectado a db '${dbName}' (pool compartido: refCount=${entry.refCount})`);
		} catch (error: any) {
			this.lastError = error.message;
			Logger.error(`[MongoProvider] Error conectando: ${error.message}`);
			await this.#handleConnectionError();
		}
	}

	async #handleConnectionError(): Promise<void> {
		if (this.retryCount < this.config.maxRetries!) {
			this.retryCount++;
			const delay = this.config.retryDelay! * Math.pow(2, this.retryCount - 1);
			Logger.warn(`[MongoProvider] Reintentando conexión (${this.retryCount}/${this.config.maxRetries}) en ${delay}ms...`);
			await new Promise((resolve) => setTimeout(resolve, delay));
			await this.#connect();
		} else {
			Logger.error(`[MongoProvider] Se alcanzó el máximo de reintentos (${this.config.maxRetries}). No se pudo conectar a MongoDB.`);
			throw new Error(`No se pudo conectar a MongoDB después de ${this.config.maxRetries} intentos`);
		}
	}

	#scheduleReconnect(): void {
		if (this.reconnectTimer) return;

		Logger.info(`[MongoProvider] Programando reconexión en ${this.config.reconnectInterval}ms...`);
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			if (!this.isDisconnecting)
				this.#connect().catch((err) => {
					Logger.error(`[MongoProvider] Error en reconexión: ${err.message}`);
				});
		}, this.config.reconnectInterval);
	}

	@OnlyKernel()
	async start(kernelKey: symbol): Promise<void> {
		super.start(kernelKey);
		if (!this.initialized) {
			this.initialized = true;
			this.#connectPromise = this.#connect();
			this.#connectPromise.catch((err: any) => {
				Logger.error(`[MongoProvider] Error durante conexión inicial: ${err.message}`);
			});
		}
	}

	getConnection(): Connection {
		if (!this.connection) throw new Error("MongoDB no está conectado");
		return this.connection;
	}

	isConnected(): boolean {
		return this.connection?.readyState === 1;
	}

	getModel<T>(name: string): Model<T> {
		if (!this.connection) throw new Error("MongoDB no está conectado");
		return this.connection.model<T>(name);
	}

	createModel<T>(name: string, schema: Schema): Model<T> {
		if (!this.connection) throw new Error("MongoDB no está conectado");
		try {
			return this.connection.model<T>(name);
		} catch {
			return this.connection.model<T>(name, schema);
		}
	}

	getStats(): { connected: boolean; connectionString: string; retries: number; lastError?: string } {
		return {
			connected: this.connection?.readyState === 1,
			// Sin la contraseña: esto sale por el panel de módulos y por logs.
			connectionString: redactMongoUri(this.config.uri),
			retries: this.retryCount,
			lastError: this.lastError,
		};
	}

	async getOrCreateConnection(uri: string): Promise<Connection> {
		const { physicalKey, dbName } = computePhysicalKey(uri);
		const entry = await this.#acquirePhysical(physicalKey);
		this.#extraPhysicalKeys.add(physicalKey);

		const view = this.#getDbView(entry, dbName);
		const cacheKey = `${entry.physical.host}:${entry.physical.port}/${dbName}`;
		this.#dbViewsCache.set(cacheKey, view);
		return view;
	}

	useDb(connection: Connection, dbName: string): Connection {
		const key = `${connection.host}:${connection.port}/${dbName}`;
		const cached = this.#dbViewsCache.get(key);
		if (cached) return cached;

		const dbConnection = connection.useDb(dbName, { useCache: true });
		this.#dbViewsCache.set(key, dbConnection);
		Logger.debug(`[MongoProvider] Vista lógica creada: ${dbName}`);
		return dbConnection;
	}

	/**
	 * Libera una vista lógica creada con `useDb({ useCache: true })`.
	 *
	 * Mongoose la cachea a nivel driver (`Connection.relatedDbs`/`otherDbs`), NO en nuestro
	 * `#dbViewsCache`: borrar sólo nuestra entrada deja la vista y sus modelos compilados retenidos
	 * ahí para siempre, así que una LRU de más arriba acotaría su objeto pero no la memoria real.
	 * Pensado para el `onEvict` de esa LRU — llamarlo con la vista en uso deja a quien la retenga
	 * con un connection "disconnected".
	 */
	releaseDbView(connection: Connection, dbName: string): void {
		const key = `${connection.host}:${connection.port}/${dbName}`;
		if (!this.#dbViewsCache.delete(key)) return;
		try {
			// Existe en runtime (`NativeConnection.prototype.removeDb`) pero no está en los
			// tipos de mongoose.
			(connection as Connection & { removeDb(name: string): void }).removeDb(dbName);
		} catch {
			// Ya liberada (carrera con otro release, o nunca se cacheó con `useCache: true`).
		}
	}

	createModelForDb<T>(dbConnection: Connection, name: string, schema: Schema): Model<T> {
		try {
			return dbConnection.model<T>(name);
		} catch {
			return dbConnection.model<T>(name, schema);
		}
	}

	async closeConnection(uri: string): Promise<void> {
		const { physicalKey } = computePhysicalKey(uri);
		if (!this.#extraPhysicalKeys.has(physicalKey)) return;

		const entry = SHARED_POOLS.get(physicalKey);
		if (entry) {
			const hostPort = `${entry.physical.host}:${entry.physical.port}`;
			for (const key of this.#dbViewsCache.keys()) {
				if (key.startsWith(hostPort)) this.#dbViewsCache.delete(key);
			}
		}

		this.#extraPhysicalKeys.delete(physicalKey);
		await this.#releasePhysical(physicalKey);
	}

	getMultiDbStats(): MultiDbStats {
		const connections: MultiDbStats["connections"] = [];
		for (const [physicalKey, entry] of SHARED_POOLS) {
			const { counters } = entry;
			connections.push({
				uri: redactMongoUri(physicalKey),
				databases: [...entry.dbViews.keys()],
				connected: entry.physical.readyState === 1,
				refCount: entry.refCount,
				maxPoolSize: entry.maxPoolSize,
				minPoolSize: entry.minPoolSize,
				// Los contadores sólo crecen, pero un cierre puede llegar antes que su creación
				// en el orden de eventos: el piso en 0 evita reportar negativos.
				openConnections: Math.max(0, counters.created - counters.closed),
				inUseConnections: Math.max(0, counters.checkedOut - counters.checkedIn),
			});
		}
		return { connections };
	}

	async #disconnect(): Promise<void> {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}

		if (this.physicalKey) {
			const key = this.physicalKey;
			this.physicalKey = null;
			this.connection = null;
			await this.#releasePhysical(key);
			Logger.ok(`[MongoProvider] Instancia desconectada de '${this.dbName}'`);
		}
	}

	@OnlyKernel()
	async stop(kernelKey: symbol): Promise<void> {
		await super.stop(kernelKey);
		this.isDisconnecting = true;

		for (const physicalKey of this.#extraPhysicalKeys) {
			this.#extraPhysicalKeys.delete(physicalKey);
			await this.#releasePhysical(physicalKey);
		}
		this.#dbViewsCache.clear();

		await this.#disconnect();
	}
}
