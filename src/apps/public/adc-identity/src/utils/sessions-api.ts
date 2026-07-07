import { createAdcApi } from "@ui-library/utils/adc-fetch";

/**
 * Sessions admin API (SessionManagerService). Requiere permiso `security.sessions`
 * (recurso global-only) y contexto global. Revocar mata los refresh tokens; el
 * access token vigente expira solo (≤15 min).
 */
const api = createAdcApi({
	basePath: "/api/auth",
	devPort: 3000,
	credentials: process.env.NODE_ENV === "development" ? "include" : "same-origin",
});

export interface ActiveSession {
	deviceId: string;
	createdAt: string;
	expiresAt: string;
	country: string | null;
	userAgent: string;
	ip: string;
}

export const sessionsAdminApi = {
	list: async (userId: string): Promise<ActiveSession[]> => {
		const r = await api.get<{ sessions: ActiveSession[] }>(`/admin/users/${encodeURIComponent(userId)}/sessions`);
		return r.data?.sessions ?? [];
	},
	revoke: async (userId: string, deviceId?: string): Promise<{ ok: boolean; revoked: number }> => {
		const r = await api.post<{ ok: boolean; revoked: number }>(`/admin/users/${encodeURIComponent(userId)}/sessions/revoke`, {
			body: deviceId ? { deviceId } : {},
			idempotencyData: { userId, deviceId: deviceId ?? null, at: Date.now() },
		});
		return { ok: !!r.data?.ok, revoked: r.data?.revoked ?? 0 };
	},
};
