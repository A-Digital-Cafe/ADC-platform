import { platformSetting } from "@common/utils/platform-settings.ts";

const DEFAULT_BODY_LIMIT_BYTES = 1_048_576;
const MAX_BODY_LIMIT_BYTES = 25 * 1_048_576;

export function getBodyLimitBytes(): number {
	// La configuración de plataforma primero: es del clúster y el entorno es de la máquina. Cuando el
	// servicio de configuración no llegó a cargar (o no hay base), `platformSetting` devuelve
	// `undefined` y esto se comporta como antes.
	const raw = platformSetting("HTTP_BODY_LIMIT_BYTES") || process.env.HTTP_BODY_LIMIT_BYTES;
	if (!raw) return DEFAULT_BODY_LIMIT_BYTES;

	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_BODY_LIMIT_BYTES;
	return Math.min(Math.floor(parsed), MAX_BODY_LIMIT_BYTES);
}

/**
 * Techo de los bodies binarios crudos (`application/octet-stream`). Van por un parser
 * passthrough que entrega el stream sin bufferizar, y Fastify **no** aplica `bodyLimit` a
 * los parsers con esa firma: sin este techo, una sola request puede subir bytes sin fin.
 *
 * Es un techo anti-abuso, no un límite de negocio: el tope real por usuario lo pone cada
 * consumidor con su plan (ver el túnel de Drive). Por eso el default es alto — bajarlo de
 * los tamaños de archivo que los planes permiten rompe transferencias legítimas.
 */
const DEFAULT_RAW_BODY_LIMIT_BYTES = 5 * 1024 * 1024 * 1024; // 5 GiB

export function getRawBodyLimitBytes(): number {
	const raw = platformSetting("HTTP_RAW_BODY_LIMIT_BYTES") || process.env.HTTP_RAW_BODY_LIMIT_BYTES;
	if (!raw) return DEFAULT_RAW_BODY_LIMIT_BYTES;

	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_RAW_BODY_LIMIT_BYTES;
	return Math.floor(parsed);
}
