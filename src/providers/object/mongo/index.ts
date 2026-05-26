import mongoose, { Connection, Model, Schema } from "mongoose";
import { BaseProvider, ProviderType } from "../../BaseProvider.js";
import { Logger } from "../../../utils/logger/Logger.js";

interface IMongoConfig {
	uri: string;
	maxRetries?: number;
	retryDelay?: number;
	connectionTimeout?: number;
	serverSelectionTimeout?: number;
	socketTimeout?: number;
	autoReconnect?: boolean;
	reconnectInterval?: number;
}

interface MultiDbStats {
	connections: Array<{
		uri: string;
		databases: string[];
		connected: boolean;
		poolSize: number;
	}>;
}

interface SharedPoolEntry {
	physical: Connection;
	refCount: number;
	listenersAttached: boolean;
	dbViews: Map<string, Connection>;
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

function computePhysicalKey(uri: string): { physicalKey: string; dbName: string } {
	try {
		const u = new URL(uri);
		const dbName = decodeURIComponent(u.pathname.replace(/^\//, "")) || "test";
		u.pathname = "/";
		const sorted = [...u.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
		u.search = new URLSearchParams(sorted).toString();
		return { physicalKey: u.toString(), dbName };
	} catch {
		return { physicalKey: uri, dbName: "test" };
	}
}

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

	constructor(options?: any) {
		super();
		const hasExplicitUri = options && Object.hasOwn(options, "uri");
		this.config = {
			uri: hasExplicitUri ? options.uri : process.env.MONGODB_URI || "mongodb://localhost:27017/adc-platform",
			maxRetries: options?.maxRetries ?? 5,
			retryDelay: options?.retryDelay ?? 5000,
			connectionTimeout: options?.connectionTimeout ?? 10000,
			serverSelectionTimeout: options?.serverSelectionTimeout ?? 5000,
			socketTimeout: options?.socketTimeout ?? 45000,
			autoReconnect: options?.autoReconnect ?? true,
			reconnectInterval: options?.reconnectInterval ?? 10000,
		};
		mongoose.set("strict", true);
		mongoose.set("strictQuery", false);
	}

	async #acquirePhysical(physicalKey: string): Promise<SharedPoolEntry> {
		let entry = SHARED_POOLS.get(physicalKey);

		if (!entry || entry.physical.readyState === 0) {
			// Coalescer carreras: si ya hay una creación en vuelo para este key, esperarla.
			let inflight = INFLIGHT_POOLS.get(physicalKey);
			if (!inflight) {
				inflight = (async () => {
					try {
						const physical = await mongoose
							.createConnection(physicalKey, {
								connectTimeoutMS: this.config.connectionTimeout,
								serverSelectionTimeoutMS: this.config.serverSelectionTimeout,
								socketTimeoutMS: this.config.socketTimeout,
								retryWrites: true,
								retryReads: true,
								maxPoolSize: 10,
								minPoolSize: 5,
							})
							.asPromise();
						const fresh: SharedPoolEntry = { physical, refCount: 0, listenersAttached: false, dbViews: new Map() };
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

		entry.refCount++;
		if (!entry.listenersAttached) {
			this.#setupConnectionListeners(entry.physical, physicalKey);
			entry.listenersAttached = true;
		}
		return entry;
	}

	async #releasePhysical(physicalKey: string): Promise<void> {
		const entry = SHARED_POOLS.get(physicalKey);
		if (!entry) return;

		entry.refCount--;
		if (entry.refCount > 0) return;

		try {
			await entry.physical.close();
			Logger.ok(`[MongoProvider] Pool físico cerrado: ${physicalKey}`);
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

	async connect(): Promise<void> {
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
			await this.connect();
		} else {
			Logger.error(`[MongoProvider] Se alcanzó el máximo de reintentos (${this.config.maxRetries}). No se pudo conectar a MongoDB.`);
			throw new Error(`No se pudo conectar a MongoDB después de ${this.config.maxRetries} intentos`);
		}
	}

	#setupConnectionListeners(physical: Connection, physicalKey: string): void {
		physical.on("connected", () => {
			Logger.ok(`[MongoProvider] Pool conectado: ${physical.host}:${physical.port}`);
		});

		physical.on("disconnected", () => {
			const entry = SHARED_POOLS.get(physicalKey);
			if (!this.isDisconnecting) Logger.warn(`[MongoProvider] Pool desconectado: ${physical.host}:${physical.port}`);
			if (this.config.autoReconnect && !this.isDisconnecting && entry && entry.refCount > 0) {
				this.#scheduleReconnect();
			}
		});

		physical.on("error", (error: any) => {
			this.lastError = error.message;
			Logger.error(`[MongoProvider] Error de conexión: ${error.message}`);
		});

		physical.on("reconnected", () => {
			Logger.ok(`[MongoProvider] Pool reconectado: ${physical.host}:${physical.port}`);
		});
	}

	#scheduleReconnect(): void {
		if (this.reconnectTimer) return;

		Logger.info(`[MongoProvider] Programando reconexión en ${this.config.reconnectInterval}ms...`);
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			if (!this.isDisconnecting)
				this.connect().catch((err) => {
					Logger.error(`[MongoProvider] Error en reconexión: ${err.message}`);
				});
		}, this.config.reconnectInterval);
	}

	async start(kernelKey: symbol): Promise<void> {
		super.start(kernelKey);
		if (!this.initialized) {
			this.initialized = true;
			this.connect().catch((err: any) => {
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
			connectionString: this.config.uri,
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
			connections.push({
				uri: physicalKey,
				databases: [...entry.dbViews.keys()],
				connected: entry.physical.readyState === 1,
				poolSize: 10,
			});
		}
		return { connections };
	}

	async disconnect(): Promise<void> {
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

	async stop(kernelKey: symbol): Promise<void> {
		await super.stop(kernelKey);
		this.isDisconnecting = true;

		for (const physicalKey of this.#extraPhysicalKeys) {
			this.#extraPhysicalKeys.delete(physicalKey);
			await this.#releasePhysical(physicalKey);
		}
		this.#dbViewsCache.clear();

		await this.disconnect();
	}
}
