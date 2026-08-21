import * as fs from "node:fs";
import * as path from "node:path";
import type { FastifyReply } from "fastify";
import type { ILogger } from "../../../../interfaces/utils/ILogger.js";
import type { HostOptions } from "../../../../interfaces/modules/providers/IHttpServer.js";
import { applySecurityHeaders, isSafeStaticPath, looksLikeStaticAsset, resolveSafeStaticPath, staticCacheControl } from "../security/index.js";
import { matchPath } from "../routing/path-match.js";
import { contentTypeFor } from "./content-type.js";

/**
 * ¿El path cae fuera de las rutas que el SPA declaró? Sin `spaRoutes` nunca: la lista es opt-in
 * y quien no la declara conserva el 200 para todo.
 */
function isUnknownSpaRoute(routes: string[] | undefined, urlPath: string | undefined): boolean {
	if (!routes?.length || !urlPath) return false;
	// `/paths/` es la misma ruta de cliente que `/paths` para el router del SPA; sin podar la
	// barra final ningún patrón matchea y la variante con barra caería en el 404.
	const normalized = urlPath.length > 1 && urlPath.endsWith("/") ? urlPath.slice(0, -1) : urlPath;
	return !routes.some((pattern) => matchPath(pattern, normalized).matched);
}

/**
 * Caché del estático, **sin pisar** lo que ya haya puesto quien vino antes: el gate de acceso
 * marca sus respuestas `no-store` porque dependen de la cookie del visitante, y esa decisión
 * tiene que ganarle a cualquier política por nombre de archivo.
 */
function applyStaticCache(reply: FastifyReply, filePath: string): void {
	if (reply.getHeader("Cache-Control")) return;
	reply.header("Cache-Control", staticCacheControl(filePath));
}

function sendFile(reply: FastifyReply, filePath: string, contentType: string, headers?: HostOptions["headers"]): void {
	applySecurityHeaders(reply, headers);
	applyStaticCache(reply, filePath);
	reply.header("Content-Type", contentType);
	reply.send(fs.readFileSync(filePath));
}

/** Sirve un archivo del directorio de un host (o de un prefijo global), con SPA fallback opcional. */
export async function serveFile(
	logger: ILogger,
	filePath: string,
	baseDir: string,
	reply: FastifyReply,
	options?: HostOptions,
	urlPath?: string
): Promise<void> {
	try {
		if (!isSafeStaticPath(baseDir, filePath)) {
			reply.code(404).send({ error: "File not found" });
			return;
		}

		if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
			sendFile(reply, filePath, contentTypeFor(path.extname(filePath).toLowerCase()), options?.headers);
			return;
		}

		// SPA fallback: si el archivo no existe y está habilitado, servir index.html. Las URLs
		// que piden un archivo concreto quedan fuera: ahí el 200 con HTML es un error mudo
		// (ver `looksLikeStaticAsset`).
		if (options?.spaFallback && !looksLikeStaticAsset(filePath)) {
			const indexPath = resolveSafeStaticPath(baseDir, "/index.html");
			if (indexPath && fs.existsSync(indexPath)) {
				// Ruta que el SPA no declaró: mismo HTML (su router muestra el "no encontrado"),
				// pero con 404. Con 200 el crawler la trata como página real y la re-visita para
				// siempre; el status es lo único que la retira.
				if (isUnknownSpaRoute(options.spaRoutes, urlPath)) reply.code(404);
				sendFile(reply, indexPath, "text/html", options?.headers);
				return;
			}
		}

		reply.code(404).send({ error: "File not found" });
	} catch (error: any) {
		logger.logError(`Error serving file ${filePath}: ${error.message}`);
		reply.code(500).send({ error: "Internal server error" });
	}
}
