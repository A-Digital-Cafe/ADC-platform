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
import { OnlyKernel } from "../../../utils/decorators/OnlyKernel.ts";
import { Scope, assertScope, Capability, type CapabilityToken } from "@common/security/Capability.ts";
import type { EndpointMetricRow, IEndpointMetricsReader } from "@common/types/endpoints/IEndpointMetrics.ts";

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
	 * Métricas agregadas por endpoint (clave `"<METHOD> <url>"`). Hoy sale del acumulador en
	 * memoria del proceso; cualquier otro día, del hash diario de Redis.
	 *
	 * Sin gate de capability a propósito: son datos operativos de la propia capa de endpoints y
	 * el control de acceso real lo hace el permiso del endpoint que las expone.
	 */
	async getEndpointMetrics(day?: string): Promise<{ day: string; endpoints: EndpointMetricRow[] }> {
		const today = metrics.metricsDay();
		const target = day ?? today;
		if (target === today) return { day: target, endpoints: metrics.snapshot() };
		if (!this.#redis) return { day: target, endpoints: [] };
		// Un día recién cerrado puede tener delta todavía en memoria (el rollover no hace I/O):
		// volcarlo antes de leer evita mostrar el día de ayer incompleto hasta el próximo tick.
		await metrics.flush(this.#redis);
		return { day: target, endpoints: await metrics.readDay(this.#redis, target) };
	}

	/** Limpia el acumulado en memoria de una clave (o de todas). Lo ya volcado a Redis no se toca. */
	resetEndpointMetrics(key?: string): Promise<number> {
		return Promise.resolve(metrics.reset(key));
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
		// Último volcado antes de soltar el provider: si Redis ya se cayó, `flush` lo absorbe.
		if (this.#redis) await metrics.flush(this.#redis);
		this.#redis = null;

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
