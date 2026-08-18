/**
 * Sesión compartida — helper para microfrontends que necesitan leer
 * el usuario autenticado y sus permisos sin depender del app adc-auth.
 *
 * Cachea la respuesta de /api/auth/session por 30s para evitar llamadas
 * repetidas.
 *
 * Distingue tres respuestas, no dos: "hay sesión", "no hay sesión" (401, concluyente) y "no se
 * sabe" (timeout, red caída, 5xx). Confundir la tercera con la segunda es lo que desconectaba
 * visualmente a un usuario con sesión viva por un solo corte de red.
 */

import { createAdcApi } from "./adc-fetch.js";
import { noteSessionExpiry } from "./auth-refresh.js";
import { resolvePlatformPath } from "./platform-links.js";
import type { SessionResponse } from "@common/types/identity/Session.js";

export type { SessionUser, SessionResponse } from "@common/types/identity/Session.js";

const api = createAdcApi({
	basePath: "/api/auth",
	devPort: 3000,
});

const CACHE_TTL_MS = 30_000;
/**
 * TTL cuando la respuesta no fue concluyente. Corto a propósito: fijar "anónimo" por 30s tras un
 * timeout deja la UI degradada mucho después de que el backend volvió.
 */
const FAILURE_TTL_MS = 5_000;
/**
 * Deadline propio de la sonda. El de `adc-fetch` son 30s, presupuesto de una transferencia; esto es
 * una consulta de arranque de la que cuelga el primer render, y esperarla medio minuto es
 * exactamente el síntoma de "la UI se queda colgada" cuando el backend no contesta.
 */
const PROBE_TIMEOUT_MS = 4_000;
/** Última sesión conocida, para pintar mientras se revalida. Por pestaña: no sobrevive al cierre. */
const SNAPSHOT_KEY = "adc-session-snapshot";

/**
 * La caché vive en `globalThis`, no en el módulo: cada remoto federado carga su propia
 * copia de este archivo, así que un módulo por página significaba una consulta por copia
 * (tres `GET /session` idénticos en la misma carga). El objeto compartido las une.
 */
const store = globalThis as typeof globalThis & {
	__adcSession?: { cache: { data: SessionResponse; ts: number; ttl: number } | null; inflight: Promise<SessionResponse> | null };
};
store.__adcSession ??= { cache: null, inflight: null };
const shared = store.__adcSession;

/**
 * Instantánea de la última sesión válida.
 *
 * Sólo se guarda una sesión autenticada y sólo se reutiliza mientras su propio `expiresAt` siga en
 * el futuro: el token dura 15 minutos, así que la creencia de la UI caduca sola con el mismo reloj
 * del servidor. No es una decisión de autorización —cada endpoint revalida— sino qué pintar
 * mientras la respuesta real no llega.
 */
function readSnapshot(): SessionResponse | null {
	try {
		const raw = globalThis.sessionStorage?.getItem(SNAPSHOT_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as SessionResponse;
		if (!parsed?.authenticated || !parsed.expiresAt || parsed.expiresAt <= Date.now()) return null;
		return parsed;
	} catch {
		return null;
	}
}

function writeSnapshot(data: SessionResponse | null): void {
	try {
		if (data?.authenticated && data.expiresAt) globalThis.sessionStorage?.setItem(SNAPSHOT_KEY, JSON.stringify(data));
		else globalThis.sessionStorage?.removeItem(SNAPSHOT_KEY);
	} catch {
		/* modo privado / storage bloqueado: se sigue sin instantánea */
	}
}

/** Deadline de la sonda, si la plataforma lo soporta (`adc-fetch` lo combina con el suyo). */
function probeSignal(): AbortSignal | undefined {
	return typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(PROBE_TIMEOUT_MS) : undefined;
}

/**
 * Última sesión conocida **sin salir a la red**, para pintar el primer frame. `null` si no hay
 * ninguna vigente; quien la use tiene que reconciliar después con `getSession()`.
 */
export function getCachedSession(): SessionResponse | null {
	if (shared.cache && Date.now() - shared.cache.ts < shared.cache.ttl) return shared.cache.data;
	return readSnapshot();
}

/**
 * Manda al login de la app `auth` con `returnUrl` a la página actual, igual que el botón del
 * header. Existe para que las landings de las apps no tengan que hardcodear el subdominio:
 * `/login` relativo apunta al host de la app, que no sirve esa ruta.
 */
export function goToLogin(returnUrl?: string): void {
	const loc = globalThis.location;
	if (!loc) return;
	const back = returnUrl ?? loc.origin + loc.pathname;
	const target = resolvePlatformPath("auth", `/login?returnUrl=${encodeURIComponent(back)}`);
	if (target) loc.assign(target);
}

export async function getSession(force = false): Promise<SessionResponse> {
	const now = Date.now();
	if (!force && shared.cache && now - shared.cache.ts < shared.cache.ttl) return shared.cache.data;
	if (shared.inflight !== null) return shared.inflight;

	shared.inflight = (async () => {
		// Siempre `silent`: un 401 acá es la respuesta normal de un visitante anónimo, no un
		// error que merezca el toast global (se veía "No hay sesión activa" al entrar sin cuenta).
		const result = await api.get<SessionResponse>("/session", { silent: true, signal: probeSignal() });

		if (result.success && result.data) {
			const data = result.data;
			// Alimenta la renovación proactiva: la cookie es HttpOnly, así que el vencimiento
			// del access token sólo se conoce por el cuerpo de la respuesta.
			noteSessionExpiry(data.authenticated ? data.expiresAt : null);
			writeSnapshot(data);
			shared.cache = { data, ts: Date.now(), ttl: CACHE_TTL_MS };
			return data;
		}

		// 401: el servidor dice que no hay sesión. Es la única respuesta que autoriza a olvidarla.
		if (result.status === 401) {
			const data: SessionResponse = { authenticated: false };
			noteSessionExpiry(null);
			writeSnapshot(null);
			shared.cache = { data, ts: Date.now(), ttl: CACHE_TTL_MS };
			return data;
		}

		// Timeout, red caída o 5xx: no se sabe. `noteSessionExpiry(null)` acá marcaba la sesión como
		// ausente y bloqueaba la renovación durante un minuto (`ABSENT_TTL_MS`), así que un corte de
		// una sola request desconectaba a un usuario con sesión viva. Se devuelve lo último conocido
		// y se reintenta enseguida.
		const data: SessionResponse = readSnapshot() ?? { authenticated: false };
		shared.cache = { data, ts: Date.now(), ttl: FAILURE_TTL_MS };
		return data;
	})();

	try {
		return await shared.inflight;
	} finally {
		shared.inflight = null;
	}
}
