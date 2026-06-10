/**
 * Sesión compartida — helper para microfrontends que necesitan leer
 * el usuario autenticado y sus permisos sin depender del app adc-auth.
 *
 * Cachea la respuesta de /api/auth/session por 30s para evitar llamadas
 * repetidas.
 */

import { createAdcApi } from "./adc-fetch.js";
import type { SessionUser, SessionResponse } from "@common/types/identity/Session.js";

export type { SessionUser, SessionResponse };

const api = createAdcApi({
	basePath: "/api/auth",
	devPort: 3000,
});

const CACHE_TTL_MS = 30_000;
let cache: { data: SessionResponse; ts: number } | null = null;
let inflight: Promise<SessionResponse> | null = null;

export async function getSession(force = false, silent = false): Promise<SessionResponse> {
	const now = Date.now();
	if (!force && cache && now - cache.ts < CACHE_TTL_MS) return cache.data;
	if (inflight !== null) return inflight;

	inflight = (async () => {
		const result = await api.get<SessionResponse>("/session", { silent });
		const data: SessionResponse = result.success && result.data ? result.data : { authenticated: false };
		cache = { data, ts: Date.now() };
		return data;
	})();

	try {
		return await inflight;
	} finally {
		inflight = null;
	}
}
