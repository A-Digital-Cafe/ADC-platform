import { readFileSync } from "node:fs";
import type { ILogger } from "../../../../interfaces/utils/ILogger.js";

/**
 * TLS y HTTP/2 **hablados por este proceso**. Sigue existiendo para un despliegue sin borde
 * delante, pero no es la postura de la plataforma y el arranque lo dice.
 *
 * Qué se rompe al encenderlo —los clientes internos hablan `http://` fijo, y con h2 no pasan ni
 * el handshake— está medido y tabulado en `docs/guides/tls-edge.md`.
 */
export function applyInProcessTls(fastifyOptions: Record<string, unknown>, http2Enabled: boolean, logger: ILogger, isDev: boolean): void {
	const certPath = process.env.SSL_CERT_PATH;
	const keyPath = process.env.SSL_KEY_PATH;

	if (certPath && keyPath) {
		applyCertificates(fastifyOptions, http2Enabled, logger, certPath, keyPath);
		return;
	}

	if (http2Enabled && isDev) {
		// HTTP/2 en claro: sólo sirve para probar el camino h2 en la máquina de quien desarrolla.
		fastifyOptions.http2 = true;
		fastifyOptions.http2SessionTimeout = 5000;
		logger.logWarn("HTTP/2 en claro (sin TLS) en desarrollo. No es un modo de producción.");
		return;
	}

	logger.logWarn(
		http2Enabled
			? "HTTP2_ENABLED=true sin SSL_CERT_PATH/SSL_KEY_PATH: se ignora y se sirve HTTP/1.1 en claro. Es lo esperado si el TLS lo termina el borde — en ese caso apagá la variable."
			: "SSL_CERT_PATH definido sin SSL_KEY_PATH: falta la llave, así que se sirve en claro."
	);
}

function applyCertificates(
	fastifyOptions: Record<string, unknown>,
	http2Enabled: boolean,
	logger: ILogger,
	certPath: string,
	keyPath: string
): void {
	try {
		fastifyOptions.https = {
			cert: readFileSync(certPath),
			key: readFileSync(keyPath),
			// Correcto donde se respeta; en este runtime, medido, no cambia nada.
			...(http2Enabled ? { allowHTTP1: true } : {}),
		};
		if (http2Enabled) fastifyOptions.http2 = true;
		logger.logWarn(
			`TLS ${http2Enabled ? "+ HTTP/2 " : ""}servido por el propio proceso (SSL_CERT_PATH). ` +
				"La postura de la plataforma es terminar TLS en el borde y dejar este puerto plano en la red privada: " +
				"los clientes ENTRE NODOS hablan `http://` fijo y dejan de alcanzar a este nodo. Ver docs/guides/tls-edge.md."
		);
		if (http2Enabled) {
			logger.logWarn(
				"Bajo HTTP/2 no hay cabeceras de conexión: el SSE de notificaciones y las rutas crudas del túnel de dispositivos " +
					"dejan de funcionar. Y aunque va `allowHTTP1`, en este runtime NO se respeta (medido): un cliente que ofrece sólo " +
					"HTTP/1.1 no pasa siquiera el handshake TLS, así que NINGÚN cliente interno alcanza a este nodo."
			);
		}
	} catch (error: any) {
		logger.logWarn(`Error leyendo certificados SSL: ${error.message}. Se sirve en claro (TLS/HTTP2 deshabilitados).`);
	}
}
