import { UncommonResponse, type ClearCookie } from "../../../core/EndpointManagerService/index.js";
import { AuthError } from "@common/types/custom-errors/AuthError.ts";
import type { ModerationLookupService } from "../types.js";
import { buildErrorUrl } from "./errorRedirect.js";

interface LoggerLike {
	logWarn: (msg: string) => void;
}

interface RedirectBanOptions {
	moderation: ModerationLookupService | null;
	email?: string;
	ip?: string;
	clearCookies?: ClearCookie[];
	emailReason?: string;
	ipReason?: string;
}

function toBlockedUntil(expiresAt: Date | null | undefined): number | undefined {
	return expiresAt ? expiresAt.getTime() : undefined;
}

export async function assertIpNotBanned(moderation: ModerationLookupService | null, ip?: string): Promise<void> {
	if (!moderation || !ip) return;

	const ipBan = await moderation.isIpBanned(ip);
	if (ipBan.banned) {
		throw new AuthError(403, "ACCOUNT_BANNED", ipBan.reason || "Acceso bloqueado", {
			blockedUntil: toBlockedUntil(ipBan.expiresAt),
		});
	}
}

export async function assertEmailNotBanned(
	moderation: ModerationLookupService | null,
	email?: string,
	fallbackReason = "Cuenta baneada"
): Promise<void> {
	if (!moderation || !email) return;

	const emailBan = await moderation.isEmailBanned(email);
	if (emailBan.banned) {
		throw new AuthError(403, "ACCOUNT_BANNED", emailBan.reason || fallbackReason, {
			blockedUntil: toBlockedUntil(emailBan.expiresAt),
		});
	}
}

export async function redirectIfRequestBanned(options: RedirectBanOptions): Promise<void> {
	const { moderation, email, ip, clearCookies, emailReason = "Cuenta baneada", ipReason = "Acceso bloqueado" } = options;
	if (!moderation) return;

	if (email) {
		const emailBan = await moderation.isEmailBanned(email);
		if (emailBan.banned) {
			throw UncommonResponse.redirect(buildErrorUrl("/banned", { reason: emailBan.reason || emailReason }), { status: 302, clearCookies });
		}
	}

	if (!ip) return;

	const ipBan = await moderation.isIpBanned(ip);
	if (ipBan.banned) {
		throw UncommonResponse.redirect(buildErrorUrl("/banned", { reason: ipBan.reason || ipReason }), { status: 302, clearCookies });
	}
}

export async function recordLoginAttemptIp(
	moderation: ModerationLookupService | null,
	userId: string,
	ip: string | undefined,
	logger: LoggerLike
): Promise<void> {
	if (!moderation || !ip) return;

	await moderation.recordLoginAttemptIp(userId, ip).catch((e: any) => logger.logWarn(`recordLoginAttemptIp: ${e?.message || e}`));
}
