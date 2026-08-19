import type { FastifyRequest, FastifyReply } from "fastify";
import type { ILogger } from "../../../../interfaces/utils/ILogger.js";
import type { HostOptions } from "../../../../interfaces/modules/providers/IHttpServer.js";
import { applySecurityHeaders } from "../security/index.js";
import type { StaticStore } from "./static-store.js";

/**
 * Corre el gate de acceso al contenido estático. `true` = ya respondió (redirect) y el
 * llamador tiene que cortar.
 *
 * Fail-closed: si el gate lanza, se responde 403 en vez de servir. Un gate roto es un gate,
 * no un permiso — la alternativa (dejar pasar ante un error transitorio del verificador de
 * sesión) convierte cualquier hipo en una publicación del panel de administración.
 *
 * Todo lo que pase por acá sale `no-store`: la respuesta depende de la cookie del visitante y
 * una caché compartida no tiene forma de saberlo.
 */
export async function denyStaticAccess(
	logger: ILogger,
	request: FastifyRequest,
	reply: FastifyReply,
	options: Pick<HostOptions, "accessGuard" | "headers">
): Promise<boolean> {
	let redirectTo: string | null;
	try {
		redirectTo = (await options.accessGuard?.(request as FastifyRequest<any>)) ?? null;
	} catch (error: any) {
		logger.logError(`Gate de acceso falló en ${request.hostname}${request.url}: ${error?.message}`);
		applySecurityHeaders(reply, options.headers);
		reply.header("Cache-Control", "no-store");
		reply.code(403).send({ error: "FORBIDDEN" });
		return true;
	}

	reply.header("Cache-Control", "no-store");
	if (!redirectTo) return false;

	applySecurityHeaders(reply, options.headers);
	reply.redirect(redirectTo, 302);
	return true;
}

/**
 * Gates de un prefijo estático global: el del prefijo entero y los acotados a un archivo.
 * `true` = ya respondió y el llamador tiene que cortar.
 */
export async function denyGlobalStaticAccess(
	logger: ILogger,
	statics: StaticStore,
	request: FastifyRequest,
	reply: FastifyReply,
	mountPath: string,
	normalizedPath: string | null
): Promise<boolean> {
	const guard = statics.guardFor(mountPath);
	if (guard && (await denyStaticAccess(logger, request, reply, { accessGuard: guard }))) return true;

	const pathGuard = statics.pathGuardFor(mountPath, normalizedPath);
	return Boolean(pathGuard) && denyStaticAccess(logger, request, reply, { accessGuard: pathGuard });
}
