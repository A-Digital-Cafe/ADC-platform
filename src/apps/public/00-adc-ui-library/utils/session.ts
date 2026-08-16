/**
 * Sesión compartida — helper para microfrontends que necesitan leer
 * el usuario autenticado y sus permisos sin depender del app adc-auth.
 *
 * Cachea la respuesta de /api/auth/session por 30s para evitar llamadas
 * repetidas.
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
 * La caché vive en `globalThis`, no en el módulo: cada remoto federado carga su propia
 * copia de este archivo, así que un módulo por página significaba una consulta por copia
 * (tres `GET /session` idénticos en la misma carga). El objeto compartido las une.
 */
const store = globalThis as typeof globalThis & {
	__adcSession?: { cache: { data: SessionResponse; ts: number } | null; inflight: Promise<SessionResponse> | null };
};
store.__adcSession ??= { cache: null, inflight: null };
const shared = store.__adcSession;

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
	if (!force && shared.cache && now - shared.cache.ts < CACHE_TTL_MS) return shared.cache.data;
	if (shared.inflight !== null) return shared.inflight;

	shared.inflight = (async () => {
		// Siempre `silent`: un 401 acá es la respuesta normal de un visitante anónimo, no un
		// error que merezca el toast global (se veía "No hay sesión activa" al entrar sin cuenta).
		const result = await api.get<SessionResponse>("/session", { silent: true });
		const data: SessionResponse = result.success && result.data ? result.data : { authenticated: false };
		// Alimenta la renovación proactiva: la cookie es HttpOnly, así que el vencimiento
		// del access token sólo se conoce por el cuerpo de la respuesta.
		noteSessionExpiry(data.authenticated ? data.expiresAt : null);
		shared.cache = { data, ts: Date.now() };
		return data;
	})();

	try {
		return await shared.inflight;
	} finally {
		shared.inflight = null;
	}
}
