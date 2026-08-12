import type { FastifyRequest } from "@interfaces/modules/providers/IHttpServer.js";
import { sanitizeBuildId } from "@common/utils/build-id.ts";

/**
 * Cookie que fija la sesión de navegación al build con el que se cargó el documento.
 *
 * Es la transición barata hasta que exista el push de artefactos: mientras dos nodos sirvan el
 * mismo vhost con builds distintos, un cliente que cargó el documento del nodo A pide sus chunks
 * por el mismo dominio y el balanceador se los puede mandar al B, que no los tiene → 404
 * intermitente. Con la cookie, esos sub-recursos vuelven al nodo que sí los tiene.
 *
 * Ya declarada en §2 de la política de cookies (`presets/help`). Es técnica y no requiere
 * consentimiento, pero esa página promete enumerar lo que se guarda en el dispositivo: cambiarle el
 * nombre, los atributos o la duración obliga a corregirla ahí —y una vez en vigencia, con 30 días de
 * preaviso—.
 */
const COOKIE_NAME = "adc_build";

/** Sin `Max-Age`: muere con la sesión de navegación, que es exactamente lo que tiene que fijar. */
export function buildCookieHeader(buildId: string, secure: boolean): string {
	return `${COOKIE_NAME}=${buildId}; Path=/; SameSite=Lax; HttpOnly${secure ? "; Secure" : ""}`;
}

/**
 * Build al que está fijada la sesión, o `null`. Se valida la forma: el valor llega del cliente y
 * se usa para elegir a qué nodo se reenvía.
 */
export function readBuildCookie(request: FastifyRequest): string | null {
	return sanitizeBuildId((request as { cookies?: Record<string, string | undefined> }).cookies?.[COOKIE_NAME]);
}

/**
 * ¿Es una navegación (el documento) y no un sub-recurso?
 *
 * La distinción es la que hace converger al cliente: el documento **siempre** lo sirve el nodo que
 * recibió la request —con sus artefactos, los nuevos— y recién sus chunks siguen a la cookie. Así
 * una recarga adopta el build nuevo sola, en vez de quedar clavada al viejo hasta cerrar el
 * navegador.
 *
 * `Sec-Fetch-Dest` lo mandan todos los navegadores actuales y no es ambiguo; `Accept` es el
 * fallback para clientes que no lo mandan.
 */
export function isDocumentRequest(request: FastifyRequest): boolean {
	const dest = request.headers["sec-fetch-dest"];
	if (typeof dest === "string") return dest === "document" || dest === "iframe";
	return String(request.headers.accept ?? "").includes("text/html");
}
