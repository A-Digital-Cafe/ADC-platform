import { platformSetting } from "@common/utils/platform-settings.ts";

/**
 * Cuántas peticiones **con cuerpo** puede tener a la vez una misma IP.
 *
 * Va en `onRequest` y no en el rate limit por endpoint, que corre *después* de parsear el cuerpo:
 * una conexión que manda las cabeceras y se queda quieta no llega nunca a contarse.
 *
 * Sólo las peticiones con cuerpo, porque contar todo obligaría a un número enorme —el SSE deja hasta
 * diez conexiones por usuario y el túnel de dispositivos otras tantas, todas `GET` de larga
 * duración— y un tope enorme no defiende de nada. El vector es el cuerpo que no termina de llegar.
 *
 * Antes de bajarlo: se cuenta por `request.ip`, así que **sin `TRUSTED_PROXIES` declarado todo lo
 * que entre por un balanceador o por otro nodo cuenta contra una sola IP** y el tope pasa a ser
 * global. De ahí el default holgado.
 */

const DEFAULT_MAX_INFLIGHT_PER_IP = 24;

export function getMaxInflightBodiesPerIp(): number {
	const raw = platformSetting("HTTP_MAX_INFLIGHT_BODIES_PER_IP") ?? process.env.HTTP_MAX_INFLIGHT_BODIES_PER_IP;
	const parsed = Number(raw);
	if (raw !== undefined && raw !== "" && Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed);
	return DEFAULT_MAX_INFLIGHT_PER_IP;
}

const inflight = new Map<string, number>();

/**
 * Toma un lugar para `ip`. Devuelve el liberador, o `null` si esa IP ya llegó al tope.
 *
 * El liberador es idempotente y hay que llamarlo desde el cierre de la respuesta, no desde el final
 * del handler: las respuestas secuestradas (SSE, túnel, proxy) nunca vuelven al framework.
 */
export function acquireInflight(ip: string, limit: number): (() => void) | null {
	if (limit <= 0) return () => undefined;
	const current = inflight.get(ip) ?? 0;
	if (current >= limit) return null;
	inflight.set(ip, current + 1);

	let released = false;
	return () => {
		if (released) return;
		released = true;
		const now = (inflight.get(ip) ?? 1) - 1;
		// Borrar la clave y no dejarla en 0: el map lo indexa una IP elegida por el cliente, así que
		// el residuo sería una fuga de memoria con forma de contador.
		if (now <= 0) inflight.delete(ip);
		else inflight.set(ip, now);
	};
}
