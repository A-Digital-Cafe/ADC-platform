import type { IHostBasedHttpProvider, FastifyRequest, FastifyReply } from "@interfaces/modules/providers/IHttpServer.js";

/** Lo que `/healthz` necesita saber, resuelto sin salir del proceso: lo sondean cada pocos segundos. */
interface NodeHealth {
	/** `false` mientras el kernel arranca. */
	ready: boolean;
	/** Artefactos de UI que sirve este nodo. */
	buildId: string;
	/** Los que debería servir la flota, o `null` si nadie los publicó. */
	expectedBuildId: string | null;
}

/**
 * El arranque gana sobre el build: un nodo a medio cargar no sirve ni con los artefactos al día, y
 * decir "stale-build" mandaría a actualizar algo que sólo hay que esperar.
 */
function resolveStatus(ready: boolean, staleBuild: boolean): string {
	if (!ready) return "starting";
	return staleBuild ? "stale-build" : "ok";
}

/**
 * `GET /healthz` — sonda de **este proceso**, para el balanceador.
 *
 * No confundir con `GET /api/modules/status`, que es el semáforo por módulo de la página de
 * estado: aquel describe la salud del servicio de cara al usuario, éste responde una sola
 * pregunta operativa —¿le mando tráfico a este nodo?— y tiene que ser barata y sin sesión.
 *
 * Va fuera de `@RegisterEndpoint` por eso mismo: sin auth, sin CSRF, sin rate limit y sin
 * contar en las métricas de endpoints. Un balanceador la consulta cada pocos segundos, para
 * siempre.
 *
 * Devuelve **503 en dos casos**, y el `status` del cuerpo los distingue porque se operan
 * distinto:
 *
 * - `starting`: el kernel no terminó de arrancar. Pasa solo.
 * - `stale-build`: este nodo no tiene los artefactos del `build-id` vigente. **No pasa solo**:
 *   hay que actualizar el nodo. Es lo que drena al que está a mitad de un deploy, y lo que evita
 *   que dos nodos sirvan el mismo vhost con builds distintos (404 intermitentes de chunks).
 */
export function registerHealthRoute(httpProvider: IHostBasedHttpProvider, owner: string, probe: () => NodeHealth): void {
	const handler = (_request: FastifyRequest, reply: FastifyReply): void => {
		const { ready, buildId, expectedBuildId } = probe();
		const staleBuild = expectedBuildId !== null && expectedBuildId !== buildId;
		const status = resolveStatus(ready, staleBuild);
		void reply
			.code(status === "ok" ? 200 : 503)
			.header("Cache-Control", "no-store")
			.send({ status, buildId, ...(staleBuild ? { expected: expectedBuildId } : {}) });
	};
	httpProvider.registerRoute("GET", "/healthz", handler, owner);
	// HEAD por separado: hay balanceadores que sondean con HEAD, y el matcher del provider
	// resuelve por método exacto (no deriva HEAD de GET).
	httpProvider.registerRoute("HEAD", "/healthz", handler, owner);
}
