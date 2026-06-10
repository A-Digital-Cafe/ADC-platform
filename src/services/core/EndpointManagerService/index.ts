import { BaseService } from "../../BaseService.js";
import type { IHostBasedHttpProvider } from "../../../interfaces/modules/providers/IHttpServer.js";
import { type HttpMethod, type EndpointConfig, type EndpointHandler } from "./types.js";
import { setPermissionValidator } from "./decorators.js";
import type { ISessionVerifier } from "@common/types/identity/SessionVerifier.ts";
import OperationsService from "../OperationsService/index.ts";
import type RabbitMQProvider from "../../../providers/queue/rabbitmq/index.ts";
import type RedisProvider from "../../../providers/queue/redis/index.ts";
import { EndpointRegistry } from "./parts/EndpointRegistry.js";
import { createPermissionValidator } from "./parts/validator.js";
import { createHttpWrapper } from "./parts/http.js";
import { buildOpenApiDocument } from "./parts/openapi.js";
import { JobManager } from "./parts/JobManager.ts";
import { registerCsrfEndpoint } from "./parts/csrf.js";
import { resolveCsrfConfig, type CsrfOptions, type CsrfRuntimeConfig } from "./parts/csrf-config.js";
import { OnlyKernel } from "../../../utils/decorators/OnlyKernel.ts";

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
	#operationsService: OperationsService | null = null;
	readonly #registry = new EndpointRegistry(this.logger);
	#jobManager: JobManager | null = null;
	#csrfConfig: CsrfRuntimeConfig | null = null;

	static readonly JOB_TTL_SECONDS = JobManager.JOB_TTL_SECONDS;

	@OnlyKernel()
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

		// Swagger UI (U-01): habilitado en dev por defecto; en producción requiere opt-in explícito.
		const docsEnabled =
			process.env.API_DOCS_ENABLED === "true" || (process.env.NODE_ENV !== "production" && process.env.API_DOCS_ENABLED !== "false");
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
	 * Solo invocable por el Kernel (o decoradores de ciclo de vida con kernelKey).
	 * @param ownerName El nombre del propietario.
	 * @returns El número de endpoints eliminados.
	 */
	@OnlyKernel()
	unregisterEndpointsByOwner(_kernelKey: symbol, ownerName: string) {
		return this.#registry.unregisterByOwner(ownerName);
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

		this.#httpProvider = null;
		this.#csrfConfig = null;
		this.#sessionManager = null;
		this.#operationsService = null;

		await super.stop(kernelKey);
		this.logger.logDebug("EndpointManagerService detenido");
	}
}
