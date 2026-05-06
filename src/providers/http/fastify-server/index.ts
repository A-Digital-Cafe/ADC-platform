import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyCookie from "@fastify/cookie";
import fastifyFormbody from "@fastify/formbody";
import * as path from "node:path";
import * as fs from "node:fs";
import { readFileSync } from "node:fs";
import { BaseProvider, ProviderType } from "../../BaseProvider.js";
import type { IHostBasedHttpProvider, HostOptions, HttpHandler } from "../../../interfaces/modules/providers/IHttpServer.js";
import { fastifyConnectPlugin } from "@connectrpc/connect-fastify";
import type { ConnectRouter, ServiceImpl } from "@connectrpc/connect";
import {
	ALLOWED_CORS_HEADERS,
	ALLOWED_HTTP_METHODS,
	applySecurityHeaders,
	createCorsOriginGuard,
	getAllowHeader,
	getBodyLimitBytes,
	isAllowedHttpMethod,
	isSafeStaticPath,
	resolveSafeStaticPath,
} from "./security/index.js";

type FastifyHandler = (req: FastifyRequest<any>, reply: FastifyReply<any>) => void | Promise<void>;

interface RegisteredHost {
	pattern: string;
	regex: RegExp;
	directory: string;
	options: HostOptions;
	priority: number;
	routes: Map<string, Map<string, FastifyHandler>>;
}

interface GlobalRoute {
	method: string;
	path: string;
	handler: FastifyHandler;
	/** Score de especificidad. Mayor = más específica. Se usa para ordenar la tabla de matching. */
	specificity: number;
}

/**
 * Calcula la especificidad de un patrón de ruta. Más estática = mayor.
 * Garantiza que `/x/draft` se evalúe antes que `/x/:id` durante el matching.
 */
function routeSpecificity(pattern: string): number {
	const segments = pattern.split("/").filter(Boolean);
	let score = 0;
	for (const seg of segments) {
		if (seg.startsWith(":")) score += 1;
		else if (seg.includes("*")) score += 0;
		else score += 100;
	}
	// Desempate menor: rutas más largas son ligeramente preferidas.
	return score * 1000 + segments.length;
}

interface PathMatchResult {
	matched: boolean;
	params: Record<string, string>;
}

/**
 * Convierte un patrón de host a regex
 * "*.local.com" -> /^(.+)\.local\.com$/
 * "cloud.local.com" -> /^cloud\.local\.com$/
 */
function hostPatternToRegex(pattern: string): RegExp {
	const escaped = pattern.replaceAll(".", "\\.").replaceAll("*", "(.+)");
	return new RegExp(`^${escaped}$`, "i");
}

/**
 * Calcula la prioridad de un patrón de host
 * Patrones más específicos tienen mayor prioridad
 */
function calculatePriority(pattern: string, explicitPriority?: number): number {
	if (explicitPriority !== undefined) return explicitPriority;

	// Comodines tienen menor prioridad
	const wildcardCount = (pattern.match(/\*/g) || []).length;
	const parts = pattern.split(".");
	const specificity = parts.length * 10 - wildcardCount * 100;

	return specificity;
}

/**
 * Detecta si un handler es de Express (tiene 3 params: req, res, next)
 */
function isExpressHandler(handler: HttpHandler): boolean {
	return handler.length >= 3;
}

/**
 * Adapta un handler de Express a Fastify (solo cuando es necesario)
 */
function adaptExpressHandler(handler: any): FastifyHandler {
	return async (req: FastifyRequest, reply: FastifyReply) => {
		const expressRes = {
			status: (code: number) => {
				reply.code(code);
				return expressRes;
			},
			json: (data: any) => reply.send(data),
			send: (data: any) => reply.send(data),
			redirect: (url: string) => reply.redirect(url),
			setHeader: (key: string, value: string) => {
				reply.header(key, value);
				return expressRes;
			},
			header: (key: string, value: string) => {
				reply.header(key, value);
				return expressRes;
			},
			type: (contentType: string) => {
				reply.type(contentType);
				return expressRes;
			},
		};

		const next = (err?: any) => {
			if (err) reply.code(500).send({ error: err.message || "Internal error" });
		};

		await handler(req, expressRes, next);
	};
}

/**
 * Normaliza un handler a formato Fastify
 */
function normalizeHandler(handler: HttpHandler): FastifyHandler {
	if (isExpressHandler(handler)) {
		return adaptExpressHandler(handler);
	}
	return handler as FastifyHandler;
}

/**
 * Implementación del servidor HTTP con Fastify y soporte para host-based routing
 */
export default class FastifyServerProvider extends BaseProvider implements IHostBasedHttpProvider {
	public readonly name = "fastify-server";
	public readonly type = ProviderType.HTTP_SERVER_PROVIDER;
	private readonly app: FastifyInstance<any>;
	private isListening = false;
	private readonly registeredHosts = new Map<string, RegisteredHost>();
	private readonly globalRoutes: GlobalRoute[] = [];
	private readonly globalStaticPaths = new Map<string, string>();
	private defaultHost: RegisteredHost | null = null;

	constructor() {
		super();
		const http2Enabled = process.env.HTTP2_ENABLED === "true";

		// Configuración base de Fastify
		const fastifyOptions: any = {
			logger: false,
			bodyLimit: getBodyLimitBytes(),
			routerOptions: {
				ignoreTrailingSlash: true,
			},
		};

		// Configurar HTTP/2 si está habilitado
		if (http2Enabled) {
			fastifyOptions.http2 = true;

			// HTTP/2 requiere HTTPS. Buscar certificados o usar auto-firmados en desarrollo
			const certPath = process.env.SSL_CERT_PATH;
			const keyPath = process.env.SSL_KEY_PATH;

			if (certPath && keyPath) {
				try {
					fastifyOptions.https = {
						cert: readFileSync(certPath),
						key: readFileSync(keyPath),
					};
					this.logger.logInfo("HTTP/2 habilitado con certificados SSL personalizados");
				} catch (error: any) {
					this.logger.logWarn(`Error leyendo certificados SSL: ${error.message}. HTTP/2 deshabilitado.`);
					delete fastifyOptions.http2;
				}
			} else if (process.env.NODE_ENV === "development") {
				// En desarrollo, permitir HTTP/2 sin TLS (cleartext)
				fastifyOptions.http2 = true;
				fastifyOptions.http2SessionTimeout = 5000;
				this.logger.logWarn("HTTP/2 habilitado en modo desarrollo sin TLS (no recomendado para producción)");
			} else {
				this.logger.logWarn("HTTP/2 requiere certificados SSL. Define SSL_CERT_PATH y SSL_KEY_PATH o desactiva HTTP2_ENABLED.");
				delete fastifyOptions.http2;
			}
		}

		this.app = Fastify(fastifyOptions);
	}
	public async start(_kernelKey: symbol): Promise<void> {
		await this.setupMiddleware();
	}

	private async setupMiddleware(): Promise<void> {
		// CORS - En desarrollo permitir credenciales desde cualquier localhost
		const isDev = process.env.NODE_ENV === "development";
		await this.app.register(
			fastifyCors as any,
			{
				origin: createCorsOriginGuard(isDev, () => this.getRegisteredHosts()),
				credentials: true,
				methods: ALLOWED_HTTP_METHODS,
				allowedHeaders: ALLOWED_CORS_HEADERS,
			} as any
		);

		this.app.addHook("onRequest", async (request, reply) => {
			applySecurityHeaders(reply);
			if (!isAllowedHttpMethod(request.method)) {
				reply.header("Allow", getAllowHeader());
				reply.code(405).send({ error: "METHOD_NOT_ALLOWED", message: `Method ${request.method} is not allowed` });
				return;
			}
		});

		// Cookie parser - Necesario para setCookie/clearCookie en endpoints
		await this.app.register(fastifyCookie);

		// Body parser para formularios
		await this.app.register(fastifyFormbody);

		// Log de peticiones en desarrollo
		if (process.env.NODE_ENV === "development") {
			this.app.addHook("onRequest", async (request) => {
				this.logger.logDebug(`${request.method} ${request.hostname}${request.url}`);
			});
		}

		// Hook principal para host-based routing
		this.app.addHook("preHandler", (async (request: FastifyRequest<any>, _reply: FastifyReply<any>) => {
			const hostname = this.extractHostname(request);
			const matchedHost = this.matchHost(hostname);

			if (matchedHost) {
				// Almacenar el host matcheado en la request para uso posterior
				(request as any).matchedHost = matchedHost;
			}
		}) as any);

		// Usar setNotFoundHandler en lugar de catch-all para permitir que
		// Connect RPC y otras rutas registradas posteriormente funcionen
		this.app.setNotFoundHandler((async (request: FastifyRequest<any>, reply: FastifyReply<any>) => {
			await this.handleStaticRequest(request, reply);
		}) as any);
	}

	private extractHostname(request: FastifyRequest): string {
		const host = request.hostname || request.headers.host || "";
		// Eliminar puerto si existe
		return host.split(":")[0].toLowerCase();
	}

	private matchHost(hostname: string): RegisteredHost | null {
		// Ordenar hosts por prioridad (mayor primero)
		const sortedHosts = Array.from(this.registeredHosts.values()).sort((a, b) => b.priority - a.priority);

		for (const host of sortedHosts) {
			if (host.regex.test(hostname)) {
				return host;
			}
		}

		return this.defaultHost;
	}

	private async handleStaticRequest(request: FastifyRequest, reply: FastifyReply): Promise<void> {
		const matchedHost = (request as any).matchedHost as RegisteredHost | undefined;
		let urlPath = request.url.split("?")[0];

		// Primero verificar rutas globales
		for (const route of this.globalRoutes) {
			if (route.method.toUpperCase() !== request.method) continue;

			const matchResult = this.matchPath(route.path, urlPath);
			if (matchResult.matched) {
				// Inyectar params en la request
				(request.params as any) = { ...(request.params as any), ...matchResult.params };
				return route.handler(request, reply);
			}
		}

		// Si no hay host matcheado, intentar con rutas estáticas globales
		if (!matchedHost) {
			// Buscar en rutas estáticas globales por prefijo de path
			for (const [pathPrefix, directory] of this.globalStaticPaths) {
				if (urlPath.startsWith(pathPrefix)) {
					const relativePath = urlPath.slice(pathPrefix.length) || "/index.html";
					const filePath = resolveSafeStaticPath(directory, relativePath);
					if (!filePath) {
						reply.code(404).send({ error: "File not found" });
						return;
					}
					return this.serveFile(filePath, directory, reply);
				}
			}

			reply.code(404).send({ error: "Not Found", host: request.hostname });
			return;
		}

		// Verificar rutas específicas del host
		const hostRoutes = matchedHost.routes.get(request.method.toUpperCase());
		if (hostRoutes) {
			for (const [routePath, handler] of hostRoutes) {
				const matchResult = this.matchPath(routePath, urlPath);
				if (matchResult.matched) {
					(request.params as any) = { ...(request.params as any), ...matchResult.params };
					return handler(request, reply);
				}
			}
		}

		// Las rutas API no deben servirse como archivos estáticos
		if (urlPath.startsWith("/api/")) {
			this.logger.logWarn(
				`[DEBUG] API 404: ${urlPath}, globalRoutes: ${this.globalRoutes.length}, registered: ${this.globalRoutes
					.map((r) => r.path)
					.join(", ")}`
			);
			reply.code(404).send({ error: "API route not found", path: urlPath });
			return;
		}

		// Servir archivos estáticos del host
		if (urlPath === "/" || urlPath === "") {
			urlPath = "/index.html";
		}

		const filePath = resolveSafeStaticPath(matchedHost.directory, urlPath);
		if (!filePath) {
			reply.code(404).send({ error: "File not found" });
			return;
		}
		await this.serveFile(filePath, matchedHost.directory, reply, matchedHost.options);
	}

	private matchPath(pattern: string, urlPath: string): PathMatchResult {
		// Extraer nombres de parámetros del patrón
		const paramNames: string[] = [];
		const regexPattern = pattern
			.replaceAll(/:([^/]+)/g, (_match, paramName) => {
				paramNames.push(paramName);
				return "([^/]+)";
			})
			.replaceAll("*", ".*");

		const regex = new RegExp(`^${regexPattern}$`);
		const match = urlPath.match(regex);

		if (!match) {
			return { matched: false, params: {} };
		}

		// Extraer valores de parámetros
		const params: Record<string, string> = {};
		paramNames.forEach((name, index) => {
			params[name] = match[index + 1];
		});

		return { matched: true, params };
	}

	private async serveFile(filePath: string, baseDir: string, reply: FastifyReply, options?: HostOptions): Promise<void> {
		try {
			if (!isSafeStaticPath(baseDir, filePath)) {
				reply.code(404).send({ error: "File not found" });
				return;
			}

			// Verificar que el archivo existe
			if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
				const ext = path.extname(filePath).toLowerCase();
				const contentType = this.getContentType(ext);

				applySecurityHeaders(reply, options?.headers);
				reply.header("Content-Type", contentType);
				const content = fs.readFileSync(filePath);
				reply.send(content);
				return;
			}

			// SPA fallback: si el archivo no existe y está habilitado, servir index.html
			if (options?.spaFallback) {
				const indexPath = resolveSafeStaticPath(baseDir, "/index.html");
				if (indexPath && fs.existsSync(indexPath)) {
					applySecurityHeaders(reply, options?.headers);
					reply.header("Content-Type", "text/html");
					const content = fs.readFileSync(indexPath);
					reply.send(content);
					return;
				}
			}

			reply.code(404).send({ error: "File not found" });
		} catch (error: any) {
			this.logger.logError(`Error serving file ${filePath}: ${error.message}`);
			reply.code(500).send({ error: "Internal server error" });
		}
	}

	private getContentType(ext: string): string {
		const types: Record<string, string> = {
			".html": "text/html; charset=utf-8",
			".js": "application/javascript; charset=utf-8",
			".mjs": "application/javascript; charset=utf-8",
			".css": "text/css; charset=utf-8",
			".json": "application/json; charset=utf-8",
			".png": "image/png",
			".jpg": "image/jpeg",
			".jpeg": "image/jpeg",
			".gif": "image/gif",
			".svg": "image/svg+xml",
			".ico": "image/x-icon",
			".woff": "font/woff",
			".woff2": "font/woff2",
			".ttf": "font/ttf",
			".eot": "application/vnd.ms-fontobject",
			".map": "application/json",
		};
		return types[ext] || "application/octet-stream";
	}

	/** Obtener la instancia raw de Fastify (para casos especiales) */
	getApp(): FastifyInstance<any> {
		return this.app;
	}

	/**
	 * Registra rutas Connect RPC
	 * @param routes Función que define las rutas Connect RPC
	 * @param options Opciones para Connect RPC
	 */
	async registerConnectRPC(routes: (router: ConnectRouter) => void, options?: { prefix?: string }): Promise<void> {
		try {
			await this.app.register(fastifyConnectPlugin, {
				routes,
				...options,
			});
			this.logger.logDebug(`Connect RPC registrado${options?.prefix ? ` con prefijo: ${options.prefix}` : ""}`);
		} catch (error: any) {
			this.logger.logError(`Error registrando Connect RPC: ${error.message}`);
			throw error;
		}
	}

	/**
	 * Registra un servicio Connect RPC individual
	 * @param service Implementación del servicio
	 * @param options Opciones de configuración
	 */
	async registerConnectService(service: Partial<ServiceImpl<any>>, options?: { prefix?: string }): Promise<void> {
		await this.registerConnectRPC((router) => {
			router.service(service as any, service);
		}, options);
	}

	registerRoute(method: string, path: string, handler: HttpHandler): void {
		const normalizedHandler = normalizeHandler(handler);

		this.globalRoutes.push({
			method: method.toUpperCase(),
			path,
			handler: normalizedHandler,
			specificity: routeSpecificity(path),
		});
		// Mantener invariante: tabla ordenada por especificidad descendente para
		// que el matcher (orden de iteración) priorice rutas estáticas.
		this.globalRoutes.sort((a, b) => b.specificity - a.specificity);

		this.logger.logDebug(`Ruta global registrada: ${method.toUpperCase()} ${path}`);
	}

	serveStatic(urlPath: string, directory: string): void {
		this.globalStaticPaths.set(urlPath, directory);
		this.logger.logDebug(`Archivos estáticos globales: ${urlPath} -> ${directory}`);
	}

	registerHost(hostPattern: string, directory: string, options: HostOptions = {}): void {
		const priority = calculatePriority(hostPattern, options.priority);
		const regex = hostPatternToRegex(hostPattern);

		const host: RegisteredHost = {
			pattern: hostPattern,
			regex,
			directory,
			options: {
				spaFallback: true,
				...options,
			},
			priority,
			routes: new Map(),
		};

		this.registeredHosts.set(hostPattern, host);

		// Si es un comodín genérico, usarlo como default
		if (hostPattern === "*" || hostPattern === "*.*") {
			this.defaultHost = host;
		}

		this.logger.logDebug(`Host registrado: ${hostPattern} -> ${directory} (priority: ${priority})`);
	}

	registerHostRoute(hostPattern: string, method: string, path: string, handler: HttpHandler): void {
		let host = this.registeredHosts.get(hostPattern);

		if (!host) {
			// Crear host sin directorio si no existe
			this.registerHost(hostPattern, "", { spaFallback: false });
			host = this.registeredHosts.get(hostPattern)!;
		}

		const methodUpper = method.toUpperCase();
		if (!host.routes.has(methodUpper)) {
			host.routes.set(methodUpper, new Map());
		}

		const methodMap = host.routes.get(methodUpper)!;
		methodMap.set(path, normalizeHandler(handler));
		// Reordenar el Map por especificidad descendente para que rutas
		// estáticas (e.g. `/x/draft`) ganen frente a paramétricas (`/x/:id`).
		const sorted = Array.from(methodMap.entries()).sort(([a], [b]) => routeSpecificity(b) - routeSpecificity(a));
		host.routes.set(methodUpper, new Map(sorted));
		this.logger.logDebug(`Ruta de host registrada: ${hostPattern} ${methodUpper} ${path}`);
	}

	getRegisteredHosts(): string[] {
		return Array.from(this.registeredHosts.keys());
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
			// Esperar a que el middleware esté listo antes de iniciar
			await this.app.listen({ port, host: "0.0.0.0" });
			this.isListening = true;
			this.logger.logOk(`Servidor Fastify escuchando en puerto ${port}`);

			if (this.registeredHosts.size > 0) {
				this.logger.logInfo(`Hosts virtuales registrados: ${this.registeredHosts.size}`);
				for (const [pattern] of this.registeredHosts) {
					this.logger.logDebug(`  - ${pattern}`);
				}
			}
		} catch (error: any) {
			if (error.code === "EADDRINUSE") {
				this.logger.logError(`Puerto ${port} ya está en uso`);
			} else {
				this.logger.logError(`Error en el servidor: ${error.message}`);
			}
			throw error;
		}
	}

	async stop(kernelKey: symbol): Promise<void> {
		await super.stop(kernelKey);
		if (this.isListening) {
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
}
