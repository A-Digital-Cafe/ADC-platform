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
import { OnlyKernel } from "../../../utils/decorators/OnlyKernel.ts";
import { Scope, assertScope, Capability, type CapabilityToken } from "@common/security/Capability.ts";

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
export default class EndpointManagerService extends BaseService {
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
		const docsEnabled =
			apiDocsEnabled === "true" || (process.env.NODE_ENV !== "production" && apiDocsEnabled !== "false");
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

		// Registrar en Fastify
		this.#httpProvider.registerRoute(config.method, config.url, wrappedHandler);

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
		return this.#registry.unregisterByOwner(cap.owner);
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

	// Obtiene información sobre los endpoints registrados
	getRegisteredEndpoints = () => this.#registry.getAll();

	// Obtiene estadísticas del servicio
	getStats = () => this.#registry.getStats();

	@OnlyKernel()
	async stop(kernelKey: symbol): Promise<void> {
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
