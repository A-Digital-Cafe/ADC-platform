import { RegisterEndpoint, type EndpointCtx } from "../../EndpointManagerService/index.js";
import { IdentityError } from "@common/types/custom-errors/IdentityError.js";
import { AuthError } from "@common/types/custom-errors/AuthError.js";
import { P } from "@common/types/Permissions.ts";
import type IdentityManagerService from "../index.js";
import type { Capability } from "@common/security/Capability.ts";
import type { User } from "@common/types/identity/User.js";
import { isOAuthCreatedAccount } from "@common/utils/user-metadata.js";
import { assertCanManageUser } from "../domain/hierarchy.js";
import * as TF from "./schemas/twofactor.js";
import { SuccessResponse } from "./schemas/common.js";

/**
 * Alta y baja del segundo factor de la **propia** cuenta, más el reseteo administrativo.
 *
 * El flujo tiene dos pasos a propósito (`/enroll` entrega el secreto, `/confirm` lo activa contra
 * un código real): activar en un paso deja la cuenta con un factor que nadie comprobó que funcione,
 * y a la siguiente entrada la persona queda afuera de su propia cuenta.
 */
export class TwoFactorEndpoints {
	private static identity: IdentityManagerService;
	private static cap: Capability;

	static init(identity: IdentityManagerService, cap: Capability): void {
		TwoFactorEndpoints.identity ??= identity;
		TwoFactorEndpoints.cap ??= cap;
	}

	private static get internal() {
		return TwoFactorEndpoints.identity._internal(TwoFactorEndpoints.cap);
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/identity/users/me/2fa",
		deferAuth: true,
		options: {
			tag: "IdentityManagerService/TwoFactor",
			summary: "Estado del segundo factor propio",
			description:
				"Devuelve si la verificación en dos pasos está activa, si hay una inscripción a medio hacer, cuántos códigos " +
				"de recuperación quedan sin usar y si a esta cuenta le es **obligatoria** (admin de plataforma o de alguna organización).",
			rateLimit: { max: 30, timeWindow: 60_000 },
			schema: { response: { 200: TF.TwoFactorStateResponse } },
		},
	})
	static async getState(ctx: EndpointCtx) {
		const user = await TwoFactorEndpoints.#requireSelf(ctx);
		const required = await TwoFactorEndpoints.internal.isAdminAccount(user.id);
		return TwoFactorEndpoints.internal.twoFactor.getState(user.id, required);
	}

	@RegisterEndpoint({
		method: "POST",
		url: "/api/identity/users/me/2fa/enroll",
		deferAuth: true,
		options: {
			tag: "IdentityManagerService/TwoFactor",
			summary: "Empieza la inscripción del segundo factor",
			description:
				"Verifica `currentPassword` (u OAuth: sesión viva) y devuelve un secreto TOTP nuevo junto con su URI " +
				"`otpauth://` para el QR. **El secreto se sirve una sola vez**: no queda ningún endpoint que lo vuelva a " +
				"mostrar, así que perderlo obliga a repetir la inscripción. Todavía no activa nada — eso lo hace `/confirm`.",
			skipIdempotency: true,
			rateLimit: { max: 5, timeWindow: 300_000 },
			schema: { body: TF.EnrollBody, response: { 200: TF.EnrollResponse } },
		},
	})
	static async enroll(ctx: EndpointCtx<Record<string, string>, { currentPassword?: string }>) {
		const user = await TwoFactorEndpoints.#requireSelf(ctx);
		await TwoFactorEndpoints.#assertSelfReauth(user, ctx.data?.currentPassword);

		return TwoFactorEndpoints.internal.twoFactor.startEnrollment(user.id, user.email || user.username);
	}

	@RegisterEndpoint({
		method: "POST",
		url: "/api/identity/users/me/2fa/confirm",
		deferAuth: true,
		options: {
			tag: "IdentityManagerService/TwoFactor",
			summary: "Confirma y activa el segundo factor",
			description:
				"Comprueba un código del autenticador contra el secreto pendiente y activa la verificación en dos pasos. " +
				"Devuelve los códigos de recuperación en claro: es la **única** vez que existen fuera del servidor.",
			skipIdempotency: true,
			rateLimit: { max: 10, timeWindow: 300_000 },
			schema: { body: TF.CodeBody, response: { 200: TF.RecoveryCodesResponse } },
		},
	})
	static async confirm(ctx: EndpointCtx<Record<string, string>, { code: string }>) {
		const user = await TwoFactorEndpoints.#requireSelf(ctx);
		const recoveryCodes = await TwoFactorEndpoints.internal.twoFactor.confirmEnrollment(user.id, ctx.data?.code || "");

		void TwoFactorEndpoints.identity.notifications(TwoFactorEndpoints.cap).twoFactorEnabled(user.id);
		return { recoveryCodes };
	}

	@RegisterEndpoint({
		method: "POST",
		url: "/api/identity/users/me/2fa/disable",
		deferAuth: true,
		options: {
			tag: "IdentityManagerService/TwoFactor",
			summary: "Desactiva el segundo factor propio",
			description:
				"Exige `currentPassword` (u OAuth: sesión viva) **y** un código vigente: sólo con la sesión bastaría para que " +
				"una sesión robada apagara justo la protección que la frena. Las cuentas con rol de administración no pueden " +
				"desactivarlo (409 `TWO_FACTOR_REQUIRED`); primero hay que quitarles el rol.",
			skipIdempotency: true,
			rateLimit: { max: 5, timeWindow: 300_000 },
			schema: { body: TF.DisableBody, response: { 200: SuccessResponse } },
		},
	})
	static async disable(ctx: EndpointCtx<Record<string, string>, { code: string; currentPassword?: string }>) {
		const user = await TwoFactorEndpoints.#requireSelf(ctx);

		if (await TwoFactorEndpoints.internal.isAdminAccount(user.id)) {
			throw new IdentityError(409, "TWO_FACTOR_REQUIRED", "Las cuentas con rol de administración no pueden desactivar la verificación en dos pasos");
		}

		await TwoFactorEndpoints.#assertSelfReauth(user, ctx.data?.currentPassword);
		await TwoFactorEndpoints.#assertCurrentFactor(user.id, ctx.data?.code);

		await TwoFactorEndpoints.internal.twoFactor.disable(user.id);
		void TwoFactorEndpoints.identity.notifications(TwoFactorEndpoints.cap).twoFactorDisabled(user.id);
		return { success: true };
	}

	@RegisterEndpoint({
		method: "POST",
		url: "/api/identity/users/me/2fa/recovery-codes",
		deferAuth: true,
		options: {
			tag: "IdentityManagerService/TwoFactor",
			summary: "Regenera los códigos de recuperación",
			description:
				"Emite una tanda nueva de 10 códigos e **invalida la anterior por completo**, incluidos los que no se usaron. " +
				"Mismo requisito que la baja: contraseña y código vigente.",
			skipIdempotency: true,
			rateLimit: { max: 5, timeWindow: 300_000 },
			schema: { body: TF.DisableBody, response: { 200: TF.RecoveryCodesResponse } },
		},
	})
	static async regenerateRecoveryCodes(ctx: EndpointCtx<Record<string, string>, { code: string; currentPassword?: string }>) {
		const user = await TwoFactorEndpoints.#requireSelf(ctx);
		await TwoFactorEndpoints.#assertSelfReauth(user, ctx.data?.currentPassword);
		await TwoFactorEndpoints.#assertCurrentFactor(user.id, ctx.data?.code);

		const recoveryCodes = await TwoFactorEndpoints.internal.twoFactor.regenerateRecoveryCodes(user.id);
		return { recoveryCodes };
	}

	@RegisterEndpoint({
		method: "POST",
		url: "/api/identity/users/:userId/2fa/reset",
		permissions: [P.IDENTITY.USERS.UPDATE],
		options: {
			tag: "IdentityManagerService/TwoFactor",
			summary: "Resetea el segundo factor de otra cuenta",
			description:
				"Último recurso para quien perdió el autenticador **y** los códigos de recuperación. Borra el factor: la cuenta " +
				"vuelve a entrar sólo con contraseña y, si es de administración, el propio login la obliga a inscribirse de nuevo. " +
				"Sujeto a la jerarquía de roles (no se opera sobre alguien de rango igual o superior) y notificado al equipo de seguridad.",
			skipIdempotency: true,
			schema: { params: TF.AdminResetParams, response: { 200: TF.AdminResetResponse } },
		},
	})
	static async adminReset(ctx: EndpointCtx<{ userId: string }>) {
		const { userId } = ctx.params;
		await assertCanManageUser(TwoFactorEndpoints.identity.permissions, ctx.user?.id, userId, ctx.user?.orgId);

		const target = await TwoFactorEndpoints.identity.users.getUser(userId, ctx.token!);
		if (!target) throw new IdentityError(404, "USER_NOT_FOUND", "Usuario no encontrado");

		await TwoFactorEndpoints.internal.twoFactor.disable(userId);

		const notifications = TwoFactorEndpoints.identity.notifications(TwoFactorEndpoints.cap);
		void notifications.twoFactorDisabled(userId, { byAdmin: true });
		void notifications.securityEvent({
			title: "Segundo factor reseteado",
			body: `Se reseteó la verificación en dos pasos de '${target.username}'.`,
			actorId: ctx.user?.id,
			data: { targetUserId: userId },
		});

		return { success: true };
	}

	// ============ Auxiliares ============

	/** Usuario de la sesión, resuelto desde identity (los endpoints `deferAuth` no lo traen entero). */
	static async #requireSelf(ctx: EndpointCtx<any, any>): Promise<User> {
		if (!ctx.user) throw new AuthError(401, "UNAUTHORIZED", "No hay usuario autenticado");

		const user = await TwoFactorEndpoints.identity.users.getUser(ctx.user.id, ctx.token!);
		if (!user) throw new IdentityError(404, "USER_NOT_FOUND", "Usuario no encontrado");
		return user as User;
	}

	/** Mismo criterio que `/change-password` y la rectificación self-service (ver `UserEndpoints`). */
	static async #assertSelfReauth(user: User, currentPassword?: string): Promise<void> {
		if (!currentPassword) {
			if (isOAuthCreatedAccount(user)) return;
			throw new IdentityError(400, "MISSING_FIELDS", "currentPassword es requerido");
		}
		const isValid = await TwoFactorEndpoints.internal.users.verifyUserPassword(user.id, currentPassword);
		if (!isValid) throw new AuthError(401, "INVALID_PASSWORD", "Contraseña actual incorrecta");
	}

	/** Exige un código vigente (del autenticador o de recuperación) para las operaciones destructivas. */
	static async #assertCurrentFactor(userId: string, code: string | undefined): Promise<void> {
		if (!code) throw new IdentityError(400, "MISSING_FIELDS", "code es requerido");

		const method = await TwoFactorEndpoints.internal.twoFactor.verify(userId, code);
		if (!method) throw new IdentityError(400, "INVALID_TOTP", "El código no es válido");
	}
}
