import { AuthError } from "@common/types/custom-errors/AuthError.ts";
import type { User } from "@common/types/identity/User.js";
import type { LoginAttemptTracker } from "../domain/security/LoginAttemptTracker.js";
import type { UserBlockStatus } from "../schemas/block-status.js";
import type { UserAuthenticationResult } from "../../../core/IdentityManagerService/dao/users.ts";

export interface NativeLoginBody {
	username?: string;
	password?: string;
	orgId?: string;
}

export interface ValidNativeLoginBody {
	username: string;
	password: string;
	orgId?: string;
}

export function validateNativeLoginBody(body: NativeLoginBody | undefined): ValidNativeLoginBody {
	const { username, password, orgId } = body || {};

	if (!username || !password) {
		throw new AuthError(400, "MISSING_CREDENTIALS", "Username y password son requeridos");
	}

	return { username, password, orgId };
}

export async function resolveNativeLoginUser(
	profile: UserAuthenticationResult,
	loginTracker: LoginAttemptTracker,
	ipAddress: string
): Promise<User> {
	if (!profile) throw new AuthError(401, "INVALID_CREDENTIALS", "Credenciales inválidas");

	if ("isActive" in profile && profile.isActive === false) {
		throw new AuthError(403, "ACCOUNT_DISABLED", "Cuenta desactivada");
	}

	// Sin `id` no hay a quién contabilizarle intentos ni a quién consultarle el bloqueo:
	// tratarlo como credencial inválida es lo único seguro (fail-closed).
	const userId = profile.id;
	if (!userId) throw new AuthError(401, "INVALID_CREDENTIALS", "Credenciales inválidas");

	if ("wrongPassword" in profile && profile.wrongPassword) {
		await handleWrongNativePassword(userId, loginTracker, ipAddress);
	}

	// El bloqueo se chequea acá, con la credencial ya validada y antes de emitir sesión.
	// Consultarlo sólo en el camino de fallo dejaría entrar con la contraseña correcta a una
	// cuenta bloqueada (por fuerza bruta o por uso fraudulento de refresh tokens).
	assertNotBlocked(await loginTracker.isBlocked(userId));

	// Login correcto: limpia el contador de fallos. Sin esto los fallos se acumulan durante
	// 24 h aunque el usuario haya entrado bien entremedio, y tres tropiezos sueltos terminan
	// bloqueando a alguien legítimo.
	await loginTracker.recordLoginAttempt(userId, true, ipAddress);

	return profile as User;
}

/** Traduce un bloqueo activo al error correspondiente. No-op si la cuenta no está bloqueada. */
function assertNotBlocked(blockStatus: UserBlockStatus): void {
	if (!blockStatus.blocked) return;

	if (blockStatus.permanent) {
		throw new AuthError(403, "ACCOUNT_BLOCKED_PERMANENT", "Cuenta bloqueada");
	}

	throw new AuthError(403, "ACCOUNT_BLOCKED_TEMP", "Cuenta bloqueada temporalmente", {
		blockedUntil: blockStatus.blockedUntil ?? undefined,
	});
}

export function requiresOrgSelection(user: User, orgId: string | undefined): boolean {
	return Boolean(user.orgMemberships?.length && orgId === undefined);
}

/**
 * El `orgId` del login lo elige el cliente, así que hay que contrastarlo con las
 * membresías antes de emitir el token: ese valor viaja en la sesión como clave de
 * tenant y media plataforma lo trata como frontera de aislamiento (buzones,
 * cuotas, listados por organización). Sin token de org (`undefined`) es acceso
 * personal, que siempre es legítimo.
 */
export function assertOrgMembership(user: User, orgId: string | undefined): void {
	if (!orgId) return;
	if (!user.orgMemberships?.some((m) => m.orgId === orgId)) {
		throw new AuthError(403, "NOT_ORG_MEMBER", "No perteneces a esta organización");
	}
}

async function handleWrongNativePassword(userId: string, loginTracker: LoginAttemptTracker, ipAddress: string): Promise<never> {
	assertNotBlocked(await loginTracker.recordLoginAttempt(userId, false, ipAddress));

	throw new AuthError(401, "INVALID_CREDENTIALS", "Credenciales inválidas");
}
