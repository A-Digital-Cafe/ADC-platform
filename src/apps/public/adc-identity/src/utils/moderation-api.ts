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

/** Ban saneado (sin hashes completos de email/IP; contadores + máscaras + prefijos). */
export interface BanItem {
	id: string;
	userId: string | null;
	reason: string;
	source: string;
	externalId: string | null;
	bannedAt: string;
	expiresAt: string | null;
	active: boolean;
	unbannedAt: string | null;
	unbanReason: string | null;
	emailHashCount: number;
	ipHashCount: number;
	/** Emails enmascarados (`gp***@g***.com`); vacío en registros antiguos. */
	emailMasks: string[];
	/** Prefijos (12 hex) de los hashes, para correlación visual entre entradas. */
	emailHashPrefixes: string[];
	ipHashPrefixes: string[];
}

export const moderationApi = {
	banUser: (userId: string, data: { reason: string; expiresAt?: string | null }) =>
		api.post("/bans", { body: { userId, ...data }, idempotencyData: { userId, ...data } }),

	unbanUser: (userId: string, reason: string | undefined, intentKey: string) =>
		api.post("/unban", { body: { userId, reason }, idempotencyKey: intentKey }),

	listBans: async (activeOnly: boolean): Promise<BanItem[]> => {
		const r = await api.get<{ bans: BanItem[] }>("/bans", { params: { activeOnly: String(activeOnly) } });
		return r.data?.bans ?? [];
	},

	/** Ban raw por emails/IPs sueltos (sin usuario de plataforma; anti-evasión). */
	banRaw: (data: { emails?: string[]; ips?: string[]; reason: string; expiresAt?: string | null }) =>
		api.post("/bans", { body: data, idempotencyData: data }),

	unbanByExternal: (source: string, externalId: string, reason: string | undefined, intentKey: string) =>
		api.post("/unban", { body: { source, externalId, reason }, idempotencyKey: intentKey }),
};
