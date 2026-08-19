import * as fs from "node:fs";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { RegisteredHost } from "../types.js";
import type { StaticDispatchContext } from "./context.js";
import { denyGlobalStaticAccess } from "../static/access-gate.js";
import { serveFile } from "../static/serve-file.js";
import { resolveSafeStaticPath } from "../security/index.js";

/** Prefijos estáticos globales, con sus gates. `true` = ya respondió (servido o denegado). */
export async function serveFromGlobalStatic(
	ctx: StaticDispatchContext,
	request: FastifyRequest,
	reply: FastifyReply,
	urlPath: string,
	normalizedPath: string | null
): Promise<boolean> {
	const hit = ctx.statics.resolve(urlPath);
	if (!hit) return false;
	if (await denyGlobalStaticAccess(ctx.logger, ctx.statics, request, reply, hit.mountPath, normalizedPath)) return true;
	await serveFile(ctx.logger, hit.filePath, hit.directory, reply);
	return true;
}

/**
 * Estático del directorio del host.
 *
 * El directorio del host manda, pero no es lo único que se sirve: los assets de las UI libraries
 * (`/ui`), los de otros módulos UI (`/pub`) y el `common/public` montado en `/` son rutas
 * GLOBALES, y con un host matcheado no se consultaban nunca. Como todo host UI lleva
 * `spaFallback`, una imagen que no estaba en el build de la app devolvía el `index.html` con 200
 * y `text/html`: el `<img>` quedaba roto y la URL directa no daba ni un 404 que lo delatara.
 */
export async function serveHostStatic(
	ctx: StaticDispatchContext,
	request: FastifyRequest,
	reply: FastifyReply,
	urlPath: string,
	normalizedPath: string | null,
	host: RegisteredHost
): Promise<void> {
	const requested = urlPath === "/" || urlPath === "" ? "/index.html" : urlPath;
	const filePath = resolveSafeStaticPath(host.directory, requested);
	if (!filePath) {
		reply.code(404).send({ error: "File not found" });
		return;
	}

	if (!fs.existsSync(filePath) && (await serveFromGlobalStatic(ctx, request, reply, requested, normalizedPath))) return;

	await serveFile(ctx.logger, filePath, host.directory, reply, host.options);
}
