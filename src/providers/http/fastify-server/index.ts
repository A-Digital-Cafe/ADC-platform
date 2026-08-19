import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { BaseProvider, ProviderType } from "../../BaseProvider.js";
import { OnlyKernel } from "../../../utils/decorators/OnlyKernel.ts";
import { Scope, assertScope, type Capability } from "@common/security/Capability.ts";
import type { IHostBasedHttpProvider, HostOptions, HttpHandler, RequestForwarder } from "../../../interfaces/modules/providers/IHttpServer.js";
import { fastifyConnectPlugin } from "@connectrpc/connect-fastify";
import type { ConnectRouter, ServiceImpl } from "@connectrpc/connect";
import { getBodyLimitBytes, resolveTrustProxy } from "./security/index.js";
import { bandwidthBudget, configureBandwidth } from "@common/utils/bandwidth-governor.ts";
import { platformSetting } from "@common/utils/platform-settings.ts";
import { GlobalRouteTable } from "./routing/global-routes.js";
import { HostRegistry } from "./routing/host-registry.js";
import { stripPort } from "./routing/host-pattern.js";
import { StaticStore } from "./static/static-store.js";
import { handleStaticRequest } from "./dispatch/static-request.js";
import type { StaticDispatchContext } from "./dispatch/context.js";
import { setupMiddleware } from "./setup/middleware.js";
import { installCountryInjector, installCspNonceSealer } from "./setup/html-hooks.js";
import { applyInProcessTls } from "./setup/tls.js";
import { bindHost, warnIfPubliclyBound } from "./setup/bind.js";

/**
 * Servidor HTTP con host-based routing. Esta clase es la fachada: el estado vive en los
 * colaboradores (`routing/`, `static/`) y el trabajo por request en `dispatch/`.
 */
export default class FastifyServerProvider extends BaseProvider implements IHostBasedHttpProvider {
	public readonly name = "fastify-server";
	public readonly type = ProviderType.HTTP_SERVER_PROVIDER;
	private readonly app: FastifyInstance<any>;
	private isListening = false;
	private readonly isDev = process.env.NODE_ENV === "development";
	private apiDocsRegistered = false;
	readonly #hosts: HostRegistry;
	readonly #routes: GlobalRouteTable;
	readonly #statics: StaticStore;
	/** Desviador del gateway entre nodos, si alguno se instaló. Ver `setRequestForwarder`. */
	#requestForwarder: { forward: RequestForwarder; owner?: string } | null = null;

	constructor() {
		super();
		this.#hosts = new HostRegistry(this.logger);
		this.#routes = new GlobalRouteTable(this.logger);
		this.#statics = new StaticStore(this.logger);
		const http2Enabled = process.env.HTTP2_ENABLED === "true";

		const fastifyOptions: any = {
			logger: false,
			bodyLimit: getBodyLimitBytes(),
			routerOptions: { ignoreTrailingSlash: true },
		};

		// Proxies confiables (`TRUSTED_PROXIES`, documentado en `.env.example`). Sin lista la
		// opción no se setea y `request.ip` sigue siendo la IP del socket.
		const trustProxy = resolveTrustProxy();
		if (trustProxy) fastifyOptions.trustProxy = trustProxy;

		// TLS y HTTP/2 dentro del proceso: camino NO recomendado. Ver `applyInProcessTls`.
		if (http2Enabled || process.env.SSL_CERT_PATH) applyInProcessTls(fastifyOptions, http2Enabled, this.logger, this.isDev);

		this.app = Fastify(fastifyOptions);
	}

	@OnlyKernel()
	public async start(_kernelKey: symbol): Promise<void> {
		await super.start(_kernelKey);
		this.#applyConfiguredBandwidth();
		await setupMiddleware(this.app, {
			logger: this.logger,
			isDev: this.isDev,
			hostPatterns: () => this.getRegisteredHosts(),
			matchHost: (hostname) => this.#hosts.match(hostname),
			handleNotFound: (request, reply) => handleStaticRequest(this.#dispatchContext(), request, reply),
		});
	}

	/**
	 * Caudal de subida con el que arranca el nodo (el panel lo cambia en caliente por
	 * `configureBandwidth`). Se lee acá y no en el constructor porque la configuración de plataforma
	 * la instala un servicio que corre después de construirse este provider.
	 */
	#applyConfiguredBandwidth(): void {
		const raw = platformSetting("UPLOAD_BANDWIDTH_BYTES_PER_SEC") ?? process.env.UPLOAD_BANDWIDTH_BYTES_PER_SEC;
		const parsed = Number(raw);
		if (!raw || !Number.isFinite(parsed) || parsed <= 0) return;
		configureBandwidth(parsed);
		this.logger.logInfo(`Caudal de subida limitado a ${Math.round(bandwidthBudget() / 1024)} KiB/s repartidos entre las transferencias en curso.`);
	}

	#dispatchContext(): StaticDispatchContext {
		return {
			logger: this.logger,
			isDev: this.isDev,
			hosts: this.#hosts,
			routes: this.#routes,
			statics: this.#statics,
			tryForward: (request, reply) => this.#tryForward(request, reply),
		};
	}

	/** Obtener la instancia raw de Fastify. Requiere capability con scope `http:raw`. */
	getApp(token: Capability): FastifyInstance<any> {
		assertScope(token, Scope.HttpRaw);
		return this.app;
	}

	async registerConnectRPC(routes: (router: ConnectRouter) => void, options?: { prefix?: string }): Promise<void> {
		try {
			await this.app.register(fastifyConnectPlugin, { routes, ...options });
			const withPrefix = options?.prefix ? `con prefijo ${options.prefix}` : "";
			this.logger.logDebug(`Connect RPC registrado${withPrefix}`);
		} catch (error: any) {
			this.logger.logError(`Error registrando Connect RPC: ${error.message}`);
			throw error;
		}
	}

	async registerConnectService(service: Partial<ServiceImpl<any>>, options?: { prefix?: string }): Promise<void> {
		await this.registerConnectRPC((router) => {
			router.service(service as any, service);
		}, options);
	}

	registerRoute(method: string, path: string, handler: HttpHandler, owner?: string): void {
		this.#routes.register(method, path, handler, owner);
	}

	/**
	 * Retira las rutas de un owner. La invoca `EndpointManagerService` al desregistrar los
	 * endpoints de un módulo, para que no queden apuntando a la instancia muerta.
	 *
	 * Match por igualdad estricta: los endpoints de managers (`Owner::Manager`) quedan fuera a
	 * propósito, porque el orquestador los cubre con el gate de 503 de `setOwnerUnavailable`
	 * —mantenimiento reintentable en vez de 404—. Acá sólo caen las rutas crudas (SSE, túnel),
	 * que no pasan por ese gate.
	 *
	 * @returns Cuántas rutas se retiraron.
	 */
	unregisterRoutesByOwner(owner: string): number {
		// También las rutas de host registradas a nombre del owner (ej. el catch-all del gateway S3).
		const removed = this.#routes.removeByOwner(owner) + this.#hosts.removeRoutesByOwner(owner);
		// El desviador es una ruta más en lo que importa acá: sobrevivirle a su dueño dejaría un
		// closure de una instancia muerta decidiendo a qué nodo va cada request.
		if (this.#requestForwarder?.owner === owner) this.setRequestForwarder(null);
		if (removed > 0) this.logger.logDebug(`Rutas retiradas de '${owner}': ${removed}`);
		return removed;
	}

	/**
	 * Registra Swagger UI en `/api/docs`. El documento OpenAPI se resuelve por request vía
	 * `transformSpecification`, de modo que refleja los endpoints registrados dinámicamente
	 * después del arranque.
	 */
	async registerApiDocs(getDocument: () => Record<string, unknown>): Promise<void> {
		if (this.apiDocsRegistered) return;
		this.apiDocsRegistered = true;

		const { default: fastifySwagger } = await import("@fastify/swagger");
		const { default: fastifySwaggerUi } = await import("@fastify/swagger-ui");

		await this.app.register(fastifySwagger, { openapi: { info: { title: "ADC Platform API", version: "1.0.0" } } });
		await this.app.register(fastifySwaggerUi, { routePrefix: "/api/docs", transformSpecification: () => getDocument() as any });

		this.logger.logOk("Swagger UI disponible en /api/docs");
	}

	/** Marca un prefijo de URL como no indexable. Ver `StaticStore.addNoIndexPrefix`. */
	registerNoIndexPrefix(prefix: string): void {
		this.#statics.addNoIndexPrefix(prefix);
	}

	serveStatic(urlPath: string, directory: string, options?: Pick<HostOptions, "accessGuard" | "pathGuards">): void {
		this.#statics.mount(urlPath, directory, options);
	}

	/**
	 * Pone (o saca) un host en modo mantenimiento: mientras esté activo, cualquier request a ese
	 * host responde 503 con una página de mantenimiento. Lo usa UIFederationService cuando el
	 * modules-manager deshabilita una app (prod).
	 */
	@OnlyKernel()
	setHostMaintenance(_kernelKey: symbol, hostPattern: string, on: boolean, message?: string): void {
		this.#hosts.setMaintenance(hostPattern, on, message);
	}

	registerHost(hostPattern: string, directory: string, options: HostOptions = {}): void {
		this.#hosts.register(hostPattern, directory, options);
	}

	registerHostRoute(hostPattern: string, method: string, path: string, handler: HttpHandler, owner?: string): void {
		this.#hosts.registerRoute(hostPattern, method, path, handler, owner);
	}

	getRegisteredHosts(): string[] {
		return this.#hosts.patterns();
	}

	/**
	 * Reutiliza el mismo matcher que el ruteo, así que un host por defecto (`*`) hace que este nodo
	 * "sirva" cualquier hostname: es la verdad, porque ese comodín igual atendería la request.
	 */
	servesHost(hostname: string): boolean {
		return this.#hosts.match(stripPort(hostname)) !== null;
	}

	hasGlobalRoute(method: string, path: string): boolean {
		return this.#routes.has(method, path);
	}

	setRequestForwarder(forwarder: RequestForwarder | null, owner?: string): void {
		this.#requestForwarder = forwarder ? { forward: forwarder, owner } : null;
		this.logger.logDebug(`Desviador entre nodos ${forwarder ? `instalado${owner ? ` [${owner}]` : ""}` : "retirado"}`);
	}

	/**
	 * Un desviador que explota no puede llevarse puesta la request: se sirve localmente, que es el
	 * comportamiento sin gateway. Salvo que ya haya escrito —ahí la respuesta es suya y no hay
	 * ruteo local posible, así que se la deja terminar (o morir) sola.
	 */
	async #tryForward(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
		if (!this.#requestForwarder) return false;
		try {
			return await this.#requestForwarder.forward(request as FastifyRequest<any>, reply as FastifyReply<any>);
		} catch (error: any) {
			this.logger.logWarn(`Desvío entre nodos fallido (${error?.message}): se sirve localmente`);
			return reply.raw.headersSent || reply.raw.writableEnded;
		}
	}

	supportsHostRouting(): boolean {
		return true;
	}

	async listen(port: number): Promise<void> {
		if (this.isListening) {
			this.logger.logWarn("El servidor ya está escuchando");
			return;
		}

		try {
			// Los inyectores de HTML van acá y no en `setupMiddleware`: tienen que ser los ÚLTIMOS
			// hooks `onSend` registrados. Ver `installCspNonceSealer`.
			installCountryInjector(this.app);
			installCspNonceSealer(this.app, this.logger);
			const host = bindHost();
			warnIfPubliclyBound(host, this.logger);
			await this.app.listen({ port, host });
			this.isListening = true;
			this.logger.logOk(`Servidor Fastify escuchando en ${host}:${port}`);

			if (this.#hosts.size > 0) {
				this.logger.logInfo(`Hosts virtuales registrados: ${this.#hosts.size}`);
				for (const pattern of this.#hosts.patterns()) this.logger.logDebug(`  - ${pattern}`);
			}
		} catch (error: any) {
			if (error.code === "EADDRINUSE") this.logger.logError(`Puerto ${port} ya está en uso`);
			else this.logger.logError(`Error en el servidor: ${error.message}`);
			throw error;
		}
	}

	@OnlyKernel()
	async stop(kernelKey: symbol): Promise<void> {
		await super.stop(kernelKey);
		if (!this.isListening) return;
		try {
			await this.app.close();
			this.isListening = false;
			this.logger.logOk("Servidor Fastify detenido");
		} catch (error: any) {
			this.logger.logError(`Error cerrando servidor: ${error.message}`);
			throw error;
		}
	}
}
