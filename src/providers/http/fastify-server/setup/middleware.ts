import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyCookie from "@fastify/cookie";
import fastifyFormbody from "@fastify/formbody";
import type { ILogger } from "../../../../interfaces/utils/ILogger.js";
import type { RegisteredHost } from "../types.js";
import { ALLOWED_CORS_HEADERS, ALLOWED_HTTP_METHODS, createCorsOriginGuard, warnIfCorsAllowlistEmpty, warnIfNoTrustedProxies } from "../security/index.js";
import { requestHostname } from "../routing/host-pattern.js";
import { installInflightCap, installMethodGuard, installTrafficShaper } from "./hooks.js";
import { rawStreamParser } from "./raw-body.js";

export interface MiddlewareContext {
	logger: ILogger;
	isDev: boolean;
	hostPatterns: () => string[];
	matchHost: (hostname: string) => RegisteredHost | null;
	handleNotFound: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

/** Plugins, hooks y parsers del servidor, en el orden en que tienen que correr. */
export async function setupMiddleware(app: FastifyInstance<any>, ctx: MiddlewareContext): Promise<void> {
	// CORS - En desarrollo permitir credenciales desde cualquier localhost; en producción real,
	// sólo `CORS_ALLOWED_ORIGINS` (los vhosts registrados dejaron de ser allowlist).
	warnIfCorsAllowlistEmpty(ctx.logger);
	warnIfNoTrustedProxies(ctx.logger);
	await app.register(
		fastifyCors as any,
		{
			origin: createCorsOriginGuard(ctx.isDev, ctx.hostPatterns),
			credentials: true,
			methods: ALLOWED_HTTP_METHODS,
			allowedHeaders: ALLOWED_CORS_HEADERS,
		} as any
	);

	installMethodGuard(app);
	installInflightCap(app, ctx.logger);

	// Cookie parser - Necesario para setCookie/clearCookie en endpoints
	await app.register(fastifyCookie);
	// Body parser para formularios
	await app.register(fastifyFormbody);

	// Modelado del cuerpo entrante (inactividad + caudal), ANTES de los parsers: es lo que lo
	// distingue del techo de tamaño, que sólo mira los binarios crudos.
	installTrafficShaper(app, ctx.logger);

	// El cast en cada registro es porque TS no elige el overload con callback de
	// `addContentTypeParser` fuera del call site.
	app.addContentTypeParser("application/octet-stream", rawStreamParser as any);
	// Catch-all con la misma semántica: sin él, cualquier Content-Type no registrado muere en un
	// 415 ANTES de llegar a los handlers. Lo exige el gateway S3 (S3GatewayService): el PUT
	// presignado del navegador lleva el Content-Type real del archivo (`image/png`, `video/mp4`,
	// …) y tiene que atravesar el proxy como stream. Para los endpoints normales el cambio es
	// benigno: un tipo inesperado ahora llega como Readable y lo rechaza la validación (400).
	app.addContentTypeParser("*", rawStreamParser as any);

	if (ctx.isDev) {
		app.addHook("onRequest", async (request) => {
			ctx.logger.logDebug(`${request.method} ${request.hostname}${request.url}`);
		});
	}

	// Hook principal para host-based routing: deja el host resuelto en la request.
	app.addHook("preHandler", (async (request: FastifyRequest<any>) => {
		const matchedHost = ctx.matchHost(requestHostname(request));
		if (matchedHost) (request as any).matchedHost = matchedHost;
	}) as any);

	// `setNotFoundHandler` en lugar de un catch-all, para que Connect RPC y las rutas registradas
	// más tarde sigan funcionando.
	app.setNotFoundHandler((async (request: FastifyRequest<any>, reply: FastifyReply<any>) => {
		await ctx.handleNotFound(request, reply);
	}) as any);
}
