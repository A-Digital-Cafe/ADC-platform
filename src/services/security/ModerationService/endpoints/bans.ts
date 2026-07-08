import { RegisterEndpoint, type EndpointCtx } from "../../../core/EndpointManagerService/index.js";
import { AuthError } from "@common/types/custom-errors/AuthError.ts";
import { ModerationError } from "@common/types/custom-errors/ModerationError.ts";
import { P } from "@common/types/Permissions.ts";
import type ModerationService from "../index.js";
import type { ModerationInternalApi } from "../index.js";
import type { Capability } from "@common/security/Capability.ts";
import { parseBanRequest } from "./utils/banValidation.js";
import { AuthorizationError } from "@common/types/custom-errors/AuthorizationError.ts";
import * as BS from "./schemas/bans.js";

interface BanBody {
	userId?: string;
	emails?: string[];
	ips?: string[];
	reason?: string;
	expiresAt?: string | null;
}

/** Largo del prefijo de hash expuesto en la UI (correlación visual, no lookup). */
const HASH_PREFIX_LEN = 12;

interface UnbanBody {
	userId?: string;
	source?: string;
	externalId?: string;
	reason?: string;
}

/**
 * Endpoints HTTP de moderación — solo admin global.
 *
 * Restringimos por org: si `ctx.user?.orgId` existe (admin de org), 403.
 */
export class BanEndpoints {
	static #service: ModerationService;
	static #cap: Capability;

	static init(service: ModerationService, cap: Capability): void {
		this.#service ??= service;
		this.#cap ??= cap;
	}

	private static api(): ModerationInternalApi {
		return this.#service._internal(this.#cap);
	}

	private static assertGlobalAdmin(ctx: EndpointCtx): void {
		if (!ctx.user) throw new AuthError(401, "UNAUTHORIZED", "No hay sesión");
		if (ctx.user.orgId) throw new AuthorizationError("Solo admin global puede moderar bans", "FORBIDDEN");
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/moderation/bans",
		permissions: [P.IDENTITY.USERS.READ],
		options: {
			tag: "ModerationService/Bans",
			summary: "Lista bans",
			description:
				"Solo admin global. No expone los hashes completos de email/IP (PII proxy); devuelve contadores, máscaras (`gp***@g***.com`) y prefijos de hash para correlación visual.",
			schema: { querystring: BS.ListBansQuery, response: { 200: BS.ListBansResponse } },
		},
	})
	static async listBans(ctx: EndpointCtx) {
		BanEndpoints.assertGlobalAdmin(ctx);
		const activeOnly = ctx.query?.activeOnly !== "false";
		const limit = Math.min(Number.parseInt(ctx.query?.limit as string, 10) || 200, 500);
		const offset = Math.max(Number.parseInt(ctx.query?.offset as string, 10) || 0, 0);
		const rawQ = typeof ctx.query?.q === "string" ? ctx.query.q.trim() : "";
		const q = rawQ.length >= 2 ? rawQ : undefined;
		const { items: bans, total } = await BanEndpoints.api().listBans({ activeOnly, limit, offset, q }, ctx.token!);
		// Sanitización: NO devolvemos los hashes completos (PII proxy). Las máscaras no
		// son reversibles y los prefijos (12 hex) solo sirven para correlacionar entradas.
		return {
			total,
			bans: bans.map((b) => ({
				id: b.id,
				userId: b.userId,
				reason: b.reason,
				source: b.source,
				externalId: b.externalId,
				bannedAt: b.bannedAt,
				expiresAt: b.expiresAt,
				active: b.active,
				unbannedAt: b.unbannedAt,
				unbanReason: b.unbanReason,
				emailHashCount: b.emailHashes.length,
				ipHashCount: b.ipHashes.length,
				emailMasks: b.emailMasks ?? [],
				emailHashPrefixes: b.emailHashes.map((h) => h.slice(0, HASH_PREFIX_LEN)),
				ipHashPrefixes: b.ipHashes.map((h) => h.slice(0, HASH_PREFIX_LEN)),
			})),
		};
	}

	@RegisterEndpoint({
		method: "POST",
		url: "/api/moderation/bans",
		permissions: [P.IDENTITY.USERS.UPDATE],
		options: {
			tag: "ModerationService/Bans",
			summary: "Crea un ban",
			description: "Con `userId` orquesta el baneo completo (Identity + blocklist + permisos); con `emails`/`ips` agrega un ban raw.",
			schema: { body: BS.CreateBanBody, response: { 200: BS.CreateBanResponse } },
		},
	})
	static async createBan(ctx: EndpointCtx<Record<string, string>, BanBody>) {
		BanEndpoints.assertGlobalAdmin(ctx);
		const { userId, emails, ips } = ctx.data || {};
		const { reason, expiresAt: expDate } = parseBanRequest(ctx.data);

		if (!userId && !(emails?.length || ips?.length)) {
			throw new ModerationError(400, "MISSING_TARGET", "Provee userId o emails/ips");
		}

		// Si viene `userId`, orquestamos baneo completo (Identity + blocklist + permisos).
		// Si no, solo agregamos entrada raw a la blocklist (emails/IPs sueltos, bans externos).
		const api = BanEndpoints.api();
		// Jerarquía de roles: ni auto-ban ni banear a jerarquía igual o superior.
		if (userId) await api.assertCanModerate(ctx.user?.id, userId);
		const record = userId
			? await api.banUserById(userId, { reason, expiresAt: expDate }, ctx.token!)
			: await api.addRawBan({ emails: emails || [], ips: ips || [], reason, expiresAt: expDate, source: "manual" }, ctx.token!);

		return { ok: true, id: record.id };
	}

	@RegisterEndpoint({
		method: "POST",
		url: "/api/moderation/unban",
		permissions: [P.IDENTITY.USERS.UPDATE],
		options: {
			tag: "ModerationService/Bans",
			summary: "Levanta un ban",
			description: "Por `userId` o por (`source` + `externalId`). Devuelve cuántas entradas se eliminaron.",
			schema: { body: BS.UnbanBody, response: { 200: BS.UnbanResponse } },
		},
	})
	static async unban(ctx: EndpointCtx<Record<string, string>, UnbanBody>) {
		BanEndpoints.assertGlobalAdmin(ctx);
		const { userId, source, externalId, reason } = ctx.data || {};
		const api = BanEndpoints.api();
		if (userId) await api.assertCanModerate(ctx.user?.id, userId);
		let removed: number;
		if (userId) removed = await api.unbanUserById(userId, reason, ctx.token!);
		else if (source && externalId) removed = await api.unbanByExternalId(source, externalId, reason, ctx.token!);
		else throw new ModerationError(400, "MISSING_TARGET", "Provee userId o (source + externalId)");

		return { ok: true, removed };
	}
}
