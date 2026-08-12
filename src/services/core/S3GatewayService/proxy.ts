import { createStreamingProxyHandler } from "@common/utils/http-proxy.ts";
import type { IHostBasedHttpProvider } from "@interfaces/modules/providers/IHttpServer.js";

export interface S3ProxyDeps {
	httpProvider: IHostBasedHttpProvider;
	/** Vhost público del gateway (ej. `s3.adigitalcafe.com`). */
	publicHost: string;
	upstreamHost: string;
	upstreamPort: number;
	/** `name` del servicio dueño: habilita retirar las rutas en `stop()`. */
	owner: string;
	logger: { logWarn(msg: string): void; logDebug(msg: string): void };
}

/** Métodos del protocolo S3 que atraviesan el gateway (presign + multipart + preflight). */
const PROXIED_METHODS = ["GET", "HEAD", "PUT", "POST", "DELETE", "OPTIONS"] as const;

/**
 * Proxy reverso streaming hacia el object storage (Garage/S3) sobre el propio proceso de la
 * plataforma, para no depender de un nginx externo. El motor es `@common/utils/http-proxy.ts`
 * (compartido con el gateway entre nodos); acá sólo vive lo que es propio de S3: la única credencial
 * de estas requests es la firma SigV4 presignada —que cubre host, path y query—, así que el gateway
 * reenvía **verbatim**, sin auth ni reescrituras.
 */
export function registerS3ProxyRoutes(deps: S3ProxyDeps): void {
	const { httpProvider, publicHost, upstreamHost, upstreamPort, owner, logger } = deps;

	const handler = createStreamingProxyHandler({
		label: "[S3Gateway]",
		logger,
		pickUpstream: () => ({ host: upstreamHost, port: upstreamPort }),
		onUpstreamHeaders: (headers, request) => {
			// El socket va hijackeado, así que @fastify/cors no toca esta respuesta. Si el upstream
			// no trae CORS y el fetch es cross-origin, se completa con `*`: las URLs presignadas
			// viajan sin cookies (la firma ES la credencial), así que el comodín no expone sesión.
			// Es un relleno propio de S3, no del motor: en un gateway con sesión sería un agujero.
			if (request.raw.headers.origin && !headers["access-control-allow-origin"]) {
				headers["access-control-allow-origin"] = "*";
			}
		},
		errorCodes: { unavailable: "S3_UPSTREAM_UNAVAILABLE", writeFailed: "S3_UPSTREAM_WRITE_FAILED" },
	});

	for (const method of PROXIED_METHODS) {
		httpProvider.registerHostRoute(publicHost, method, "/*", handler, owner);
	}
	logger.logDebug(`[S3Gateway] Rutas ${PROXIED_METHODS.join("/")} /* registradas para ${publicHost}`);
}
