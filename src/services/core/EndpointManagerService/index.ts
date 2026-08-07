import { BaseService } from "../../BaseService.js";
import type { IHostBasedHttpProvider } from "../../../interfaces/modules/providers/IHttpServer.js";
import { type HttpMethod, type EndpointConfig, type EndpointHandler } from "./types.js";
import { setPermissionValidator } from "./decorators.js";
import type { ISessionVerifier } from "@common/types/identity/SessionVerifier.ts";
import type { IOperationsService } from "@common/types/operations/IOperationsService.js";
import type RabbitMQProvider from "../../../providers/queue/rabbitmq/index.ts";
import type RedisProvider from "../../../providers/queue/redis/index.ts";
import { EndpointRegistry } from "./parts/EndpointRegistry.js";
import { createPermissionValidator } from "./parts/validator.js";
import { createHttpWrapper } from "./parts/http.js";
import { buildOpenApiDocument } from "./parts/openapi.js";
import { JobManager } from "./parts/JobManager.ts";
import { registerCsrfEndpoint } from "./parts/csrf.js";
import { resolveCsrfConfig, type CsrfOptions, type CsrfRuntimeConfig } from "./parts/csrf-config.js";
import { resolveRateLimitConfig, type RateLimitConfig, type ResolvedRateLimits } from "./parts/rate-limit.js";
import * as metrics from "./parts/metrics.js";
import { emptyAggregate, mergeAggregate, toRow, type MetricAggregate } from "./parts/metrics-aggregate.js";
import { METRICS_SCHEMAS, MetricsStore, type HourlyMetricDoc, type MeasuredHourDoc } from "./parts/metrics-store.js";
import type MongoProvider from "../../../providers/object/mongo/index.ts";
import { OnlyKernel } from "../../../utils/decorators/OnlyKernel.ts";
import { Scope, assertScope, Capability, type CapabilityToken } from "@common/security/Capability.ts";
import type { EndpointMetricsPage, IEndpointMetricsReader } from "@common/types/endpoints/IEndpointMetrics.ts";

// Re-exportar decoradores para uso externo
export { RegisterEndpoint, EnableEndpoints, DisableEndpoints, readEndpointMetadata, readEnableEndpointsConfig } from "./decorators.js";

// Re-exportar tipos, HttpError y UncommonResponse
export {
	UncommonResponse,
	type EndpointConfig,
	type EndpointCtx,
	type EndpointHandler,
	type HttpMethod,
	type RegisteredEndpoint,
	type AuthenticatedUserInfo,
	type EnableEndpointsConfig,
	type CookieOptions,
	type SetCookie,
	type ClearCookie,
	type JobStatus,
} from "./types.js";

/**
 * EndpointManagerService - Gestión centralizada de endpoints HTTP
 */
export default class EndpointManagerService extends BaseService implements IEndpointMetricsReader {
	public readonly name = "EndpointManagerService";

	#httpProvider: IHostBasedHttpProvider | null = null;
	// SessionManager se carga con lazy-load pattern en #getSessionManager()
	#sessionManager: ISessionVerifier | null = null;
	#operationsService: IOperationsService | null = null;
	readonly #registry = new EndpointRegistry(this.logger);
	#jobManager: JobManager | null = null;
	#csrfConfig: CsrfRuntimeConfig | null = null;
	#rateLimits: ResolvedRateLimits | null = null;
	/** Owners marcados como no disponibles (503). Mapea nombre→mensaje. */
	readonly #unavailableOwners = new Map<string, string>();
	#redis: RedisProvider | null = null;
	#metricsTimer: ReturnType<typeof setInterval> | null = null;
	/** Archivo horario de métricas. `null` hasta que Mongo conecta (o para siempre, si no conecta). */
	#metricsStore: MetricsStore | null = null;
	#archiveTimer: ReturnType<typeof setTimeout> | null = null;
	#archiving = false;

	static readonly JOB_TTL_SECONDS = JobManager.JOB_TTL_SECONDS;

	@OnlyKernel()
	async start(kernelKey: symbol): Promise<void> {
		await super.start(kernelKey);
		this.#httpProvider = this.getMyProvider<IHostBasedHttpProvider>("fastify-server");
		this.#operationsService = this.getMyService<IOperationsService>("OperationsService");
		this.#csrfConfig = resolveCsrfConfig(this.config.csrf as CsrfOptions | undefined);
		this.#rateLimits = resolveRateLimitConfig(this.config.rateLimit as RateLimitConfig | undefined);

		const rabbitmq = this.getMyProvider<RabbitMQProvider>("queue/rabbitmq");
		const redis = this.getMyProvider<RedisProvider>("queue/redis");
		this.#redis = redis;

		// El hot path sólo toca el acumulador en memoria; el I/O de métricas pasa entero por este flush.
		const metricsConfig = metrics.configureMetrics(this.config.metrics as metrics.MetricsConfig | undefined);
		if (metricsConfig.enabled && redis) {
			this.#metricsTimer = setInterval(() => {
				metrics.flush(redis).catch((err) => this.logger.logDebug(`Flush de métricas falló: ${err?.message ?? err}`));
			}, metricsConfig.flushIntervalMs);
			// El archivo horario NO bloquea el arranque: este servicio es `kernelMode` y `failOnError`,
			// y esperar a Mongo acá pondría el boot entero detrás de una base que todavía puede estar
			// levantando. Mientras no conecte, la ventana muestra sólo la hora en curso.
			void this.#startMetricsArchive();
		}

		this.#jobManager = new JobManager({
			logger: this.logger,
			getSessionManager: this.#getSessionManager.bind(this),
			operationsService: this.#operationsService,
			rabbitmq,
			redis,
			httpProvider: this.#httpProvider,
		});

		if (this.#httpProvider && redis) {
			this.#jobManager.registerJobEndpoint(this.#httpProvider);
		}

		if (this.#httpProvider) {
			registerCsrfEndpoint(this.#httpProvider, this.#csrfConfig);
		}

		// Swagger UI (U-01): habilitado en dev por defecto; en producción requiere opt-in explícito.
		const apiDocsEnabled = (this.config.apiDocs as { enabled?: string } | undefined)?.enabled;
		const docsEnabled = apiDocsEnabled === "true" || (process.env.NODE_ENV !== "production" && apiDocsEnabled !== "false");
		if (docsEnabled && this.#httpProvider?.registerApiDocs) {
			try {
				await this.#httpProvider.registerApiDocs(() => buildOpenApiDocument(this.#registry.getAllFull()));
			} catch (error) {
				this.logger.logWarn(`No se pudo registrar Swagger UI: ${error}`);
			}
		}

		this.logger.logOk("EndpointManagerService iniciado");
	}

	/**
	 * Lazy-load singleton getter para SessionManagerService
	 * Intenta obtener el servicio solo si no está cargado.
	 * Tipado contra el contrato ISessionVerifier (no la clase concreta).
	 */
	#getSessionManager(): ISessionVerifier | null {
		if (!this.#sessionManager) {
			try {
				this.#sessionManager = this.getMyService<ISessionVerifier>("SessionManagerService");
			} catch {
				// SessionManagerService no disponible todavía
			}
		}
		return this.#sessionManager;
	}

	/**
	 * Registra un endpoint en Fastify con wrapper de permisos
	 * El handler es puro: recibe EndpointCtx y devuelve datos
	 */
	async registerEndpoint(config: {
		method: HttpMethod;
		url: string;
		permissions: string[];
		options?: EndpointConfig["options"];
		instance: object;
		methodName: string;
		handler: EndpointHandler<any, any, any>;
		ownerName: string;
	}): Promise<string> {
		if (!this.#httpProvider) {
			throw new Error("HTTP provider no disponible");
		}

		// Delegar la creación y almacenamiento del endpoint al registro
		const endpoint = this.#registry.register(config);

		// Inyectar el validador de permisos en la instancia
		setPermissionValidator(config.instance, createPermissionValidator(this.#getSessionManager.bind(this)));

		// Crear wrapper HTTP que construye ctx y maneja HttpError
		const wrappedHandler = createHttpWrapper(
			endpoint,
			this.#getSessionManager.bind(this),
			this.#operationsService!,
			this.logger,
			this.#csrfConfig ?? resolveCsrfConfig(this.config.csrf as CsrfOptions | undefined),
			this.#rateLimits ?? resolveRateLimitConfig(this.config.rateLimit as RateLimitConfig | undefined),
			this.getMyProvider<RabbitMQProvider>("queue/rabbitmq"),
			this.getMyProvider<RedisProvider>("queue/redis"),
			() => this.#checkOwnerUnavailable(config.ownerName)
		);

		// El `ownerName` viaja para que `unregisterEndpointsByOwner` pueda retirar también la ruta.
		this.#httpProvider.registerRoute(config.method, config.url, wrappedHandler, config.ownerName);

		// ── Set up queue consumer if endpoint uses enqueue ──────────────────
		const isMutative = ["POST", "PUT", "PATCH", "DELETE"].includes(config.method);
		if (isMutative && config.options?.enqueue && this.#jobManager?.hasQueue) {
			await this.#jobManager.setupConsumer(
				config.ownerName,
				config.methodName,
				endpoint,
				this.#operationsService!,
				config.options.queueOptions
			);
		}

		this.logger.logDebug(`Endpoint registrado: ${config.method} ${config.url} [${config.ownerName}]`);

		return endpoint.id;
	}

	/**
	 * Elimina todos los endpoints asociados a un owner. Operación de infraestructura de
	 * endpoints (la invoca el decorador `@DisableEndpoints` en el teardown del servicio,
	 * o el orquestador): sin gate por token, ya que sólo desregistra rutas por `ownerName`
	 * (no da acceso a datos ni escala privilegios).
	 * @returns El número de endpoints eliminados.
	 */
	unregisterEndpointsByOwner(cap: CapabilityToken) {
		// El owner se deriva de la capability del caller: un módulo sólo puede desregistrar
		// SUS PROPIOS endpoints (no los de otro), sin depender de un token compartido.
		if (!Capability.is(cap)) throw new Error("unregisterEndpointsByOwner: capability requerida");
		const removed = this.#registry.unregisterByOwner(cap.owner);
		// También las rutas de Fastify: limpiar sólo el registro interno deja la tabla global
		// sirviendo el wrapper de la instancia destruida.
		this.#httpProvider?.unregisterRoutesByOwner?.(cap.owner);
		return removed;
	}

	/**
	 * Marca (o desmarca) un owner como "no disponible": sus endpoints responden 503
	 * sin invocar el handler. El match cubre el owner exacto y sus managers
	 * (`Owner::Manager`). Lo usa el ModuleOrchestrator al detener un servicio en
	 * caliente (antes de descargarlo). Gateado por `platform:infra`: sólo el kernel/orquestador
	 * (que portan esa capability) pueden togglear el 503 de un owner arbitrario.
	 */
	setOwnerUnavailable(cap: CapabilityToken, ownerName: string, on: boolean, message?: string): void {
		assertScope(cap, Scope.PlatformInfra);
		if (on) this.#unavailableOwners.set(ownerName, message || "Servicio temporalmente no disponible");
		else this.#unavailableOwners.delete(ownerName);
		this.logger.logDebug(`Owner ${ownerName} ${on ? "marcado NO disponible (503)" : "disponible de nuevo"}`);
	}

	/** Devuelve el mensaje de 503 si el owner (o su prefijo de servicio) está no disponible. */
	#checkOwnerUnavailable(ownerName: string): { message?: string } | null {
		if (this.#unavailableOwners.size === 0) return null;
		for (const [key, message] of this.#unavailableOwners) {
			if (ownerName === key || ownerName.startsWith(`${key}::`)) return { message };
		}
		return null;
	}

	/**
	 * Conecta el archivo horario en segundo plano y deja programado el cierre de hora. Si Mongo
	 * nunca conecta, la única consecuencia es que la ventana se queda en la hora en curso.
	 */
	async #startMetricsArchive(): Promise<void> {
		try {
			const mongo = this.getMyProvider<MongoProvider>("object/mongo");
			await this.waitForProvider(mongo, "MongoDB (métricas de endpoints)");
			this.#metricsStore = new MetricsStore(
				mongo.createModel<HourlyMetricDoc>("endpoint_metrics_hourly", METRICS_SCHEMAS.hourly),
				mongo.createModel<MeasuredHourDoc>("endpoint_metrics_hours", METRICS_SCHEMAS.measuredHour)
			);
		} catch (error: any) {
			this.logger.logWarn(`Métricas sin histórico horario (Mongo no disponible): ${error?.message ?? error}`);
			return;
		}
		// Arranque: puede haber horas cerradas sin archivar (kernel apagado, Mongo caído).
		await this.#archiveClosedHours();
		this.#scheduleNextArchive();
	}

	/**
	 * Dispara el archivado justo después de cada cambio de hora. Se reprograma con `setTimeout`
	 * en vez de un `setInterval` de una hora porque el intervalo deriva, y con la deriva el cierre
	 * terminaría cayendo dentro de la hora siguiente.
	 */
	#scheduleNextArchive(): void {
		const nextHour = metrics.hourStartMs() + 3_600_000;
		// Margen sobre el límite: da tiempo a que el flush del ticker deje la hora completa en Redis.
		const delay = Math.max(1000, nextHour + 30_000 - Date.now());
		this.#archiveTimer = setTimeout(() => {
			void this.#archiveClosedHours().finally(() => this.#scheduleNextArchive());
		}, delay);
	}

	/**
	 * Vuelca a Mongo cada hora ya cerrada que siga teniendo hash en Redis y lo borra, y después
	 * poda lo que quedó fuera de la retención. Las horas candidatas se enumeran desde el reloj
	 * (no con `KEYS`), así que el barrido es acotado y no crece con la base.
	 */
	async #archiveClosedHours(): Promise<void> {
		const store = this.#metricsStore;
		const redis = this.#redis;
		if (!store || !redis || this.#archiving) return;
		this.#archiving = true;
		try {
			// Primero el flush: una hora recién cerrada puede tener delta en memoria todavía.
			await metrics.flush(redis);
			for (const hour of metrics.closedHoursToArchive()) {
				const rows = await metrics.readHour(redis, hour);
				const startsAt = Date.parse(`${hour}:00:00.000Z`);
				// Una hora sin hash puede ser tranquila (kernel arriba, cero requests) o no medida
				// (kernel caído). Sólo la primera cuenta como medida, y se sabe por el arranque del
				// proceso; sin esta marca una noche tranquila inflaría la media de llamadas/hora.
				if (rows.size === 0 && startsAt < metrics.measuringSince()) continue;
				await store.archiveHour(hour, new Date(startsAt), rows, metrics.ownerOf);
				// Sólo después de archivar: si Mongo falló, el hash sigue ahí y se reintenta.
				if (rows.size > 0) await metrics.dropHour(redis, hour);
			}
			// La hora que se cayó del borde de la ventana: "cada hora se borra la 25ava".
			await store.purgeBefore(new Date(metrics.hourStartMs() - metrics.retentionHours() * 3_600_000));
		} catch (error: any) {
			this.logger.logDebug(`Archivado de métricas falló (se reintenta): ${error?.message ?? error}`);
		} finally {
			this.#archiving = false;
		}
	}

	/** Tramo de la hora en curso: lo ya volcado a Redis más el delta que el hot path no volcó todavía. */
	async #currentHourAggregates(): Promise<Map<string, MetricAggregate>> {
		const current = this.#redis ? await metrics.readHour(this.#redis, metrics.currentHourLabel()) : new Map<string, MetricAggregate>();
		for (const [key, delta] of metrics.unflushedDelta()) {
			const existing = current.get(key);
			if (existing) mergeAggregate(existing, delta);
			else current.set(key, delta);
		}
		return current;
	}

	/**
	 * Ventana móvil de 24 h por endpoint (clave `"<METHOD> <url>"`): las horas archivadas en Mongo
	 * más el tramo de la hora en curso. El tramo parcial se suma a los totales —para que una
	 * tanda de 500 se vea en el acto— pero queda fuera de `perHour`, que promedia sólo horas
	 * completas.
	 *
	 * Sin gate de capability a propósito: son datos operativos de la propia capa de endpoints y
	 * el control de acceso real lo hace el permiso del endpoint que las expone.
	 */
	async getEndpointMetrics(): Promise<EndpointMetricsPage> {
		const now = Date.now();
		const archived = this.#metricsStore
			? await this.#metricsStore.readWindow(metrics.windowHours(now))
			: { covered: [] as string[], byKey: new Map() };
		const current = await this.#currentHourAggregates();

		const endpoints = [...new Set([...archived.byKey.keys(), ...current.keys()])].map((key) => {
			const past = archived.byKey.get(key);
			const live = current.get(key);
			const agg = emptyAggregate();
			if (past) mergeAggregate(agg, past.agg);
			if (live) mergeAggregate(agg, live);
			return toRow(agg, {
				key,
				// El dueño en memoria manda: el archivado puede traer el de un despliegue anterior.
				owner: metrics.ownerOf(key) || past?.owner || "",
				hourly: past?.hourly ?? new Array<number>(archived.covered.length).fill(0),
				currentCount: live?.count ?? 0,
			});
		});

		return {
			generatedAt: new Date(now).toISOString(),
			currentHourStart: new Date(metrics.hourStartMs(now)).toISOString(),
			hours: archived.covered.map((hour) => `${hour}:00:00.000Z`),
			endpoints,
		};
	}

	/**
	 * Borra una clave (o todas) de la ventana entera: memoria, hora en curso en Redis e histórico
	 * archivado. Limpiar sólo la memoria dejaría 24 h de historia intacta y la tabla no se movería,
	 * que es exactamente lo contrario de lo que promete el botón.
	 */
	async resetEndpointMetrics(key?: string): Promise<number> {
		const cleared = new Set(metrics.reset(key));
		if (this.#redis) {
			const hour = metrics.currentHourLabel();
			if (key) await metrics.dropKeyFromHour(this.#redis, hour, key).catch(() => undefined);
			else await metrics.dropHour(this.#redis, hour).catch(() => undefined);
		}
		for (const archivedKey of (await this.#metricsStore?.clear(key)) ?? []) cleared.add(archivedKey);
		if (key) return cleared.has(key) ? 1 : 0;
		return cleared.size;
	}

	// Obtiene información sobre los endpoints registrados
	getRegisteredEndpoints = () => this.#registry.getAll();

	// Obtiene estadísticas del servicio
	getStats = () => this.#registry.getStats();

	@OnlyKernel()
	async stop(kernelKey: symbol): Promise<void> {
		if (this.#metricsTimer) {
			clearInterval(this.#metricsTimer);
			this.#metricsTimer = null;
		}
		if (this.#archiveTimer) {
			clearTimeout(this.#archiveTimer);
			this.#archiveTimer = null;
		}
		// Último volcado antes de soltar el provider: si Redis ya se cayó, `flush` lo absorbe.
		// Lo que quede en el hash de la hora en curso lo recoge el barrido de arranque siguiente.
		if (this.#redis) await metrics.flush(this.#redis);
		this.#redis = null;
		this.#metricsStore = null;

		// Graceful shutdown: drain all queue consumers first
		if (this.#jobManager) {
			await this.#jobManager.shutdown();
			this.#jobManager = null;
		}

		// Limpiar todos los endpoints
		this.#registry.clear();
		this.#unavailableOwners.clear();

		this.#httpProvider = null;
		this.#csrfConfig = null;
		this.#sessionManager = null;
		this.#operationsService = null;

		await super.stop(kernelKey);
		this.logger.logDebug("EndpointManagerService detenido");
	}
}
