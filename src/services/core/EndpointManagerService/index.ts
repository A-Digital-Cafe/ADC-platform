import { BaseService } from "../../BaseService.js";
import type { IHostBasedHttpProvider } from "../../../interfaces/modules/providers/IHttpServer.js";
import { type HttpMethod, type EndpointConfig, type EndpointHandler, type ServiceCallRequest } from "./types.js";
import { setPermissionValidator } from "./decorators.js";
import SessionManagerService from "../../security/SessionManagerService/index.ts";
import OperationsService from "../OperationsService/index.ts";
import type RabbitMQProvider from "../../../providers/queue/rabbitmq/index.ts";
import type RedisProvider from "../../../providers/queue/redis/index.ts";
import { EndpointRegistry } from "./parts/EndpointRegistry.js";
import { createPermissionValidator } from "./parts/validator.js";
import { createHttpWrapper } from "./parts/http.js";
import { internalCallEndpoint } from "./parts/internalCallEndpoint.ts";
import { JobManager } from "./parts/JobManager.ts";
import { registerCsrfEndpoint } from "./parts/csrf.js";
import { resolveCsrfConfig, type CsrfOptions, type CsrfRuntimeConfig } from "./parts/csrf-config.js";

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
	#sessionManager: SessionManagerService | null = null;
	#operationsService: OperationsService | null = null;
	readonly #registry = new EndpointRegistry(this.logger);
	#jobManager: JobManager | null = null;
	#csrfConfig: CsrfRuntimeConfig | null = null;

	static readonly JOB_TTL_SECONDS = JobManager.JOB_TTL_SECONDS;

	async start(kernelKey: symbol): Promise<void> {
		await super.start(kernelKey);
		this.#httpProvider = this.getMyProvider<IHostBasedHttpProvider>("fastify-server");
		this.#operationsService = this.getMyService<OperationsService>("OperationsService");
		this.#csrfConfig = resolveCsrfConfig(this.config.csrf as CsrfOptions | undefined);

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

		this.logger.logOk("EndpointManagerService iniciado");
	}

	/**
	 * Lazy-load singleton getter para SessionManagerService
	 * Intenta obtener el servicio solo si no está cargado
	 */
	#getSessionManager(): SessionManagerService | null {
		if (!this.#sessionManager) {
			try {
				this.#sessionManager = this.getMyService<SessionManagerService>("SessionManagerService");
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
			this.getMyProvider<RabbitMQProvider>("queue/rabbitmq"),
			this.getMyProvider<RedisProvider>("queue/redis")
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
	 * Elimina todos los endpoints asociados a un owner.
	 * @param ownerName El nombre del propietario.
	 * @returns El número de endpoints eliminados.
	 */
	unregisterEndpointsByOwner = (ownerName: string) => this.#registry.unregisterByOwner(ownerName);

	internalCallEndpoint = (request: ServiceCallRequest) =>
		internalCallEndpoint(request, this.#getSessionManager.bind(this), this.getMyService.bind(this));

	// Obtiene información sobre los endpoints registrados
	getRegisteredEndpoints = () => this.#registry.getAll();

	// Obtiene estadísticas del servicio
	getStats = () => this.#registry.getStats();

	async stop(kernelKey: symbol): Promise<void> {
		// Graceful shutdown: drain all queue consumers first
		if (this.#jobManager) {
			await this.#jobManager.shutdown();
			this.#jobManager = null;
		}

		// Limpiar todos los endpoints
		this.#registry.clear();

		this.#httpProvider = null;
		this.#csrfConfig = null;
		this.#sessionManager = null;
		this.#operationsService = null;

		await super.stop(kernelKey);
		this.logger.logDebug("EndpointManagerService detenido");
	}
}
