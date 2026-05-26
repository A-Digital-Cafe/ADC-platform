import { createAdcApi } from "@ui-library/utils/adc-fetch";

/**
 * Moderation API client
 * Endpoints unificados de moderación (ModerationService).
 *
 * - `expiresAt` opcional: omitirlo o `null` → permaban.
 * - El backend tolera fechas inválidas degradando a permaban (no rechaza la petición).
 */
const api = createAdcApi({
	basePath: "/api/moderation",
	devPort: 3000,
	credentials: process.env.NODE_ENV === "development" ? "include" : "same-origin",
});

export const moderationApi = {
	banUser: (userId: string, data: { reason: string; expiresAt?: string | null }) =>
		api.post("/bans", { body: { userId, ...data }, idempotencyData: { userId, ...data } }),

	unbanUser: (userId: string, reason?: string) =>
		api.post("/unban", { body: { userId, reason }, idempotencyData: { userId, reason: reason ?? null } }),
};
