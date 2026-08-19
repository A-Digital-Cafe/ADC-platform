import type { FastifyRequest, FastifyReply } from "fastify";
import type { RegisteredHost } from "../types.js";
import type { StaticDispatchContext } from "./context.js";
import { denyStaticAccess } from "../static/access-gate.js";
import { serveFromGlobalStatic, serveHostStatic } from "./serve-static.js";
import { matchPath } from "../routing/path-match.js";
import { serveMaintenance } from "./maintenance.js";
import { isBlockedBuildArtifact, normalizeUrlPath } from "../security/index.js";

/** Rutas registradas (globales primero, después las del host). `true` = ya la atendió alguna. */
async function dispatchRoute(
	ctx: StaticDispatchContext,
	request: FastifyRequest,
	reply: FastifyReply,
	urlPath: string,
	host?: RegisteredHost
): Promise<boolean> {
	const global = ctx.routes.find(request.method, urlPath);
	if (global) {
		(request.params as any) = { ...(request.params as any), ...global.params };
		await global.handler(request as FastifyRequest<any>, reply as FastifyReply<any>);
		return true;
	}

	const hostRoutes = host?.routes.get(request.method.toUpperCase());
	if (!hostRoutes) return false;
	for (const [routePath, handler] of hostRoutes) {
		const matched = matchPath(routePath, urlPath);
		if (!matched.matched) continue;
		(request.params as any) = { ...(request.params as any), ...matched.params };
		await handler(request as FastifyRequest<any>, reply as FastifyReply<any>);
		return true;
	}
	return false;
}

/**
 * 404s que van ANTES de resolver ningún archivo. `true` = ya respondió.
 *
 * Las rutas API no deben servirse como archivos estáticos, y el guard cubre también el caso sin
 * host matcheado: entrando por una IP o un host no registrado, un `serveStatic` de prefijo ancho
 * se traga las rutas `/api/*` y devuelve "File not found", sin dejar rastro en el log de dev.
 *
 * Los artefactos de build (source maps, `collection/`, …) se cortan acá por lo mismo: cubre por
 * igual los hosts virtuales y las rutas globales, que es por donde se sirven las UI libraries.
 */
function rejectNonServable(ctx: StaticDispatchContext, request: FastifyRequest, reply: FastifyReply, urlPath: string): boolean {
	if (urlPath.startsWith("/api/")) {
		if (ctx.isDev) ctx.logger.logDebug(`API 404: ${request.method} ${urlPath} (${ctx.routes.size} rutas globales)`);
		reply.code(404).send({ error: "API route not found", path: urlPath });
		return true;
	}
	if (isBlockedBuildArtifact(urlPath)) {
		reply.code(404).send({ error: "Not Found" });
		return true;
	}
	return false;
}

/**
 * Gates de acceso del host: el del host entero y los acotados a un prefijo (el chunk de un
 * `expose` federado, ver `HostOptions.pathGuards`). `true` = ya respondió.
 *
 * Van después del ruteo de API y de las rutas del host, para no cambiar la semántica de `/api/*`
 * (que autoriza por su cuenta) ni la de `/robots.txt` (que tiene que seguir siendo público).
 */
async function denyByHostGates(
	ctx: StaticDispatchContext,
	request: FastifyRequest,
	reply: FastifyReply,
	normalizedPath: string | null,
	host?: RegisteredHost
): Promise<boolean> {
	if (host?.options.accessGuard && (await denyStaticAccess(ctx.logger, request, reply, host.options))) return true;

	const pathGuard = host?.options.pathGuards?.find((entry) => normalizedPath?.startsWith(entry.prefix));
	if (!pathGuard) return false;
	return denyStaticAccess(ctx.logger, request, reply, { accessGuard: pathGuard.guard, headers: host?.options.headers });
}

/**
 * Todo lo que no atendió una ruta declarada en fastify: vhosts, rutas por host, estáticos y el
 * gateway entre nodos. Se engancha como `setNotFoundHandler`.
 */
export async function handleStaticRequest(ctx: StaticDispatchContext, request: FastifyRequest, reply: FastifyReply): Promise<void> {
	// El gateway entre nodos se consulta ANTES de cualquier matching local, y no como último
	// recurso: la afinidad de conexión (el túnel de Drive habla con UN dispositivo) apunta a
	// rutas que TAMBIÉN existen acá, y servirlas localmente sería contestar desde el nodo que no
	// sostiene esa conexión. Sin gateway instalado no cuesta nada y el ruteo queda idéntico.
	if (await ctx.tryForward(request, reply)) return;

	const matchedHost = (request as any).matchedHost as RegisteredHost | undefined;
	const urlPath = request.url.split("?")[0];

	// Modo mantenimiento: si el host está deshabilitado, servir 503 por default.
	const maintenance = matchedHost && ctx.hosts.maintenanceMessage(matchedHost.pattern);
	if (maintenance) {
		serveMaintenance(reply, maintenance);
		return;
	}

	if (await dispatchRoute(ctx, request, reply, urlPath, matchedHost)) return;
	if (rejectNonServable(ctx, request, reply, urlPath)) return;

	// Sobre el path NORMALIZADO: comparar el crudo mientras el archivo se resuelve decodificando
	// deja pasar `//expose_X.js`, `/./expose_X.js` y `/a/../expose_X.js`, que abren el mismo
	// archivo sin matchear el prefijo.
	const normalizedPath = normalizeUrlPath(urlPath);
	ctx.statics.applyNoIndex(reply, normalizedPath);
	if (await denyByHostGates(ctx, request, reply, normalizedPath, matchedHost)) return;

	if (matchedHost) {
		await serveHostStatic(ctx, request, reply, urlPath, normalizedPath, matchedHost);
		return;
	}

	// Sin host matcheado sólo quedan las rutas estáticas globales.
	if (await serveFromGlobalStatic(ctx, request, reply, urlPath, normalizedPath)) return;
	reply.code(404).send({ error: "Not Found", host: request.hostname });
}
