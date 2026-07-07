import { RegisterEndpoint, type EndpointCtx } from "../../../core/EndpointManagerService/index.js";
import { AuthError } from "@common/types/custom-errors/AuthError.ts";
import { P } from "@common/types/Permissions.ts";
import type { IIdentityManagerService } from "@common/types/identity/IIdentityManagerService.js";
import { assertCanManageUser } from "../../../core/IdentityManagerService/domain/hierarchy.js";
import type { RefreshTokenRepository, StoredRefreshToken } from "../domain/tokens/RefreshTokenRepository.js";
import * as SS from "./schemas/sessions.js";

interface SessionAdminDeps {
	refreshTokenRepo: RefreshTokenRepository;
	identityService: IIdentityManagerService | null;
	logger: { logWarn: (msg: string) => void; logInfo: (msg: string) => void };
	/** Aviso canónico al usuario cuyas sesiones se revocaron (`security.sessions_revoked`). */
	notifyRevoked: (targetUserId: string) => void;
	/** Alerta `security.alert` al equipo (Admins + Security Managers globales). */
	notifySecurityTeam: (event: { title: string; body: string; actorId?: string; data?: Record<string, unknown> }) => void;
}

/** Enmascara una IP para la vista admin (forense sin exponer la IP completa). */
function maskIp(ip: string): string {
	if (ip.includes(".")) {
		const parts = ip.split(".");
		return parts.length === 4 ? `${parts[0]}.${parts[1]}.x.x` : "x.x.x.x";
	}
	const idx = ip.indexOf(":");
	const idxOf = ip.indexOf(":", idx + 1) > 0 ? ip.indexOf(":", idx + 1) : idx;
	return idx > 0 ? `${ip.slice(0, idxOf)}::…` : "…";
}

function toSessionItem(token: StoredRefreshToken) {
	return {
		deviceId: token.deviceId,
		createdAt: new Date(token.createdAt).toISOString(),
		expiresAt: new Date(token.expiresAt).toISOString(),
		country: token.country,
		userAgent: token.userAgent,
		ip: maskIp(token.ipAddress),
	};
}

/**
 * Endpoints admin de sesiones (Security Manager / Admin globales, permiso
 * `security.sessions`). Recurso global-only: sólo roles globales lo portan, y
 * además se exige contexto personal (sin orgId en el token).
 *
 * Revocar mata los refresh tokens YA (la sesión no puede renovarse); el access
 * token vigente expira solo (≤15 min).
 */
export class SessionAdminEndpoints {
	private static deps: SessionAdminDeps;

	static init(deps: SessionAdminDeps): void {
		SessionAdminEndpoints.deps ??= deps;
	}

	static #assertGlobalContext(ctx: EndpointCtx): void {
		if (ctx.user?.orgId) {
			throw new AuthError(403, "FORBIDDEN", "La gestión de sesiones requiere contexto global (modo personal)");
		}
	}

	/**
	 * Jerarquía de roles (fail-closed): sin Identity disponible no se opera sobre
	 * sesiones ajenas; con Identity, ni sobre sí mismo ni sobre jerarquía ≥ propia.
	 */
	static async #assertCanManageTarget(ctx: EndpointCtx, targetUserId: string): Promise<void> {
		const { identityService } = SessionAdminEndpoints.deps;
		if (!identityService) {
			throw new AuthError(503, "IDENTITY_NOT_AVAILABLE", "IdentityManagerService no disponible para validar jerarquía");
		}
		await assertCanManageUser(identityService.permissions, ctx.user?.id, targetUserId);
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/auth/admin/users/:userId/sessions",
		permissions: [P.SECURITY.SESSIONS.READ],
		options: {
			tag: "SessionManagerService/Sessions",
			summary: "Lista las sesiones activas de un usuario",
			description:
				"Metadatos de refresh tokens vivos (dispositivo, país, user-agent, IP enmascarada). Permiso `security.sessions` (global-only).",
			schema: { params: SS.SessionsUserIdParams, response: { 200: SS.ListSessionsResponse } },
		},
	})
	static async listSessions(ctx: EndpointCtx<{ userId: string }>) {
		SessionAdminEndpoints.#assertGlobalContext(ctx);
		// Misma jerarquía que revoke: enumerar sesiones ajenas también es gestionarlas.
		await SessionAdminEndpoints.#assertCanManageTarget(ctx, ctx.params.userId);
		const tokens = await SessionAdminEndpoints.deps.refreshTokenRepo.listForUser(ctx.params.userId);
		return { sessions: tokens.map(toSessionItem) };
	}

	@RegisterEndpoint({
		method: "POST",
		url: "/api/auth/admin/users/:userId/sessions/revoke",
		permissions: [P.SECURITY.SESSIONS.DELETE],
		options: {
			tag: "SessionManagerService/Sessions",
			summary: "Revoca las sesiones de un usuario (force logout)",
			description:
				"Revoca todos los refresh tokens del usuario (o el de `deviceId` si se indica). El access token vigente expira solo (≤15 min). Respeta la jerarquía de roles: ni a sí mismo ni a jerarquía igual o superior.",
			schema: { params: SS.SessionsUserIdParams, body: SS.RevokeSessionsBody, response: { 200: SS.RevokeSessionsResponse } },
		},
	})
	static async revokeSessions(ctx: EndpointCtx<{ userId: string }, { deviceId?: string }>) {
		SessionAdminEndpoints.#assertGlobalContext(ctx);
		const { deps } = SessionAdminEndpoints;
		const targetUserId = ctx.params.userId;

		// Jerarquía de roles (fail-closed): expulsar a alguien es gestionarlo.
		await SessionAdminEndpoints.#assertCanManageTarget(ctx, targetUserId);

		let revoked = 0;
		const deviceId = ctx.data?.deviceId;
		if (deviceId) {
			const stored = await deps.refreshTokenRepo.findByUserAndDevice(targetUserId, deviceId);
			if (stored && (await deps.refreshTokenRepo.revoke(stored.token))) revoked = 1;
		} else {
			revoked = await deps.refreshTokenRepo.revokeAllForUser(targetUserId);
		}

		deps.logger.logInfo(`Sesiones revocadas: ${revoked} de ${targetUserId} por ${ctx.user?.id ?? "?"}`);
		if (revoked > 0) {
			deps.notifyRevoked(targetUserId);
			deps.notifySecurityTeam({
				title: "Sesiones revocadas",
				body: `Se revocaron ${revoked} sesión(es) de ${targetUserId}.`,
				actorId: ctx.user?.id,
				data: { userId: targetUserId, revoked, deviceId: deviceId ?? null },
			});
		}
		return { ok: true, revoked };
	}
}
