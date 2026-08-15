import { isPrivateHost } from "@common/utils/url-utils.js";
import { isRealProduction } from "@common/utils/runtime-env.ts";

export const ALLOWED_HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
// `Content-Disposition` está por el gateway S3: el PUT presignado lo lleva FIRMADO (SigV4), así
// que el preflight del vhost del gateway tiene que permitirlo o el navegador bloquea la subida.
export const ALLOWED_CORS_HEADERS = ["Content-Type", "Authorization", "Idempotency-Key", "X-CSRF-Token", "X-Requested-With", "Content-Disposition"];

function parseOriginList(): string[] {
	const raw = process.env.CORS_ALLOWED_ORIGINS || "";
	return raw
		.split(",")
		.map((origin) => origin.trim())
		.filter(Boolean);
}

/**
 * Origen de desarrollo: localhost/loopback **o IP privada de LAN** (probar desde el
 * móvil contra `bun run dev` implica origen `http://192.168.x.x:<puerto-app>`).
 * Misma regla que `IS_DEV` del front (`@common/utils/url-utils`): si el cliente se
 * considera en dev y manda `credentials: "include"`, el server debe aceptar ese origen.
 */
function isLocalOrigin(origin: string): boolean {
	try {
		const { hostname } = new URL(origin);
		return hostname === "::1" || isPrivateHost(hostname);
	} catch {
		return false;
	}
}

function hostPatternMatches(pattern: string, hostname: string): boolean {
	const escaped = pattern.replaceAll(".", String.raw`\.`).replaceAll("*", "[^.]+?");
	return new RegExp(`^${escaped}$`, "i").test(hostname);
}

/**
 * Sólo matchean los vhosts **concretos**: los patrones con comodín (`*.adigitalcafe.com`, que
 * `adc-home` declara para ruteo por organización) quedan afuera a propósito.
 *
 * Un origen que matchea acá queda habilitado para CORS **con credenciales**, y la cookie de sesión
 * es de dominio, así que SameSite no aísla entre subdominios: con el comodín, un solo subdominio
 * tomado (un CNAME colgado, un bucket de terceros) leía y mutaba la API de cualquier usuario
 * logueado. Para habilitar un origen que no sea un vhost concreto está `CORS_ALLOWED_ORIGINS`.
 */
function originMatchesRegisteredHost(origin: string, hosts: string[]): boolean {
	try {
		const { hostname } = new URL(origin);
		return hosts.some((host) => !host.includes("*") && hostPatternMatches(host, hostname));
	} catch {
		return false;
	}
}

/**
 * ¿El origen es uno de los vhosts **concretos** de la plataforma?
 *
 * Pregunta distinta de la de CORS —que decide quién puede llamar a la API con credenciales— y por
 * eso va aparte: la usan el anti-CSRF del túnel de Drive y los headers del SSE de notificaciones
 * (que va sobre el socket hijackeado y se saltea el hook de `@fastify/cors`).
 * @public
 */
export function isPlatformOrigin(origin: string | undefined, registeredHosts: string[]): boolean {
	if (!origin) return false;
	// Fuera de producción real no hay vhosts que matchear: cada app vive en su propio puerto de
	// localhost/LAN y ESE es el origen "nuestro" (sin esto el SSE se queda sin CORS en dev).
	if (!isRealProduction() && isLocalOrigin(origin)) return true;
	return originMatchesRegisteredHost(origin, registeredHosts);
}

/**
 * Política de orígenes para CORS **con credenciales**.
 *
 * En producción real la allowlist es **sólo** `CORS_ALLOWED_ORIGINS`: registrar un vhost sirve para
 * que la plataforma responda en ese host, no para volverlo un origen de API con sesión ajena. Fuera
 * de producción real se aceptan además los vhosts concretos y los orígenes locales, porque en dev
 * cada app vive en su propio puerto y el front manda `credentials: "include"`.
 */
export function createCorsOriginGuard(isDevelopment: boolean, getRegisteredHosts: () => string[]) {
	const configuredOrigins = parseOriginList();
	return (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
		if (!origin) return callback(null, true);
		if (configuredOrigins.includes(origin)) return callback(null, true);
		if (isRealProduction()) return callback(null, false);
		if (isDevelopment && isLocalOrigin(origin)) return callback(null, true);
		return callback(null, isPlatformOrigin(origin, getRegisteredHosts()));
	};
}

/**
 * Aviso de arranque: en producción real una allowlist vacía deja sin CORS a cualquier origen
 * cruzado. Correcto para un despliegue de un solo host, silenciosamente roto para uno con apps en
 * varios subdominios — que es el caso de esta plataforma.
 */
export function warnIfCorsAllowlistEmpty(logger: { logWarn(message: string): void }): void {
	if (!isRealProduction() || parseOriginList().length > 0) return;
	logger.logWarn(
		"CORS: `CORS_ALLOWED_ORIGINS` está vacío en producción real. Ningún origen cruzado podrá llamar a la API " +
			"con credenciales (los vhosts registrados YA NO se toman como allowlist). Enumerá los orígenes de las apps."
	);
}

export function isAllowedHttpMethod(method: string): boolean {
	return (ALLOWED_HTTP_METHODS as readonly string[]).includes(method.toUpperCase());
}

export function getAllowHeader(): string {
	return ALLOWED_HTTP_METHODS.join(", ");
}
