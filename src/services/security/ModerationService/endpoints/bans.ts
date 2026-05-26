import { RegisterEndpoint, type EndpointCtx } from "../../../core/EndpointManagerService/index.js";
import { AuthError } from "@common/types/custom-errors/AuthError.ts";
import { IdentityError } from "@common/types/custom-errors/IdentityError.ts";
import { P } from "@common/types/Permissions.ts";
import type ModerationService from "../index.js";
import type { ModerationInternalApi } from "../index.js";
import { parseBanRequest } from "./banValidation.js";

interface BanBody {
	userId?: string;
	emails?: string[];
	ips?: string[];
	reason?: string;
	expiresAt?: string | null;
}

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
	static #kernelKey: symbol;

	static init(service: ModerationService, kernelKey: symbol): void {
		this.#service ??= service;
		this.#kernelKey ??= kernelKey;
	}

	private static api(): ModerationInternalApi {
		return this.#service._internal(this.#kernelKey);
	}

	private static assertGlobalAdmin(ctx: EndpointCtx): void {
		if (!ctx.user) throw new AuthError(401, "UNAUTHORIZED", "No hay sesión");
		if (ctx.user.orgId) throw new IdentityError(403, "FORBIDDEN", "Solo admin global puede moderar bans");
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/moderation/bans",
		permissions: [P.IDENTITY.USERS.READ],
	})
	static async listBans(ctx: EndpointCtx) {
		BanEndpoints.assertGlobalAdmin(ctx);
		const activeOnly = ctx.query?.activeOnly !== "false";
		const limit = Math.min(Number.parseInt(ctx.query?.limit as string, 10) || 200, 500);
		const bans = await BanEndpoints.api().listBans({ activeOnly, limit }, ctx.token!);
		// Sanitización: NO devolvemos los hashes (PII proxy) por defecto
		return {
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
			})),
		};
	}

	@RegisterEndpoint({
		method: "POST",
		url: "/api/moderation/bans",
		permissions: [P.IDENTITY.USERS.UPDATE],
	})
	static async createBan(ctx: EndpointCtx<Record<string, string>, BanBody>) {
		BanEndpoints.assertGlobalAdmin(ctx);
		const { userId, emails, ips } = ctx.data || {};
		const { reason, expiresAt: expDate } = parseBanRequest(ctx.data);

		if (!userId && !(emails?.length || ips?.length)) {
			throw new IdentityError(400, "MISSING_TARGET", "Provee userId o emails/ips");
		}

		// Si viene `userId`, orquestamos baneo completo (Identity + blocklist + permisos).
		// Si no, solo agregamos entrada raw a la blocklist (emails/IPs sueltos, bans externos).
		const api = BanEndpoints.api();
		const record = userId
			? await api.banUserById(userId, { reason, expiresAt: expDate }, ctx.token!)
			: await api.addRawBan({ emails: emails || [], ips: ips || [], reason, expiresAt: expDate, source: "manual" }, ctx.token!);

		return { ok: true, id: record.id };
	}

	@RegisterEndpoint({
		method: "POST",
		url: "/api/moderation/unban",
		permissions: [P.IDENTITY.USERS.UPDATE],
	})
	static async unban(ctx: EndpointCtx<Record<string, string>, UnbanBody>) {
		BanEndpoints.assertGlobalAdmin(ctx);
		const { userId, source, externalId, reason } = ctx.data || {};
		const api = BanEndpoints.api();
		let removed: number;
		if (userId) removed = await api.unbanUserById(userId, reason, ctx.token!);
		else if (source && externalId) removed = await api.unbanByExternalId(source, externalId, reason, ctx.token!);
		else throw new IdentityError(400, "MISSING_TARGET", "Provee userId o (source + externalId)");

		return { ok: true, removed };
	}
}
