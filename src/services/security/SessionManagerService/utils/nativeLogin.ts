import { AuthError } from "@common/types/custom-errors/AuthError.ts";
import type { User } from "@common/types/identity/User.js";
import type { LoginAttemptTracker } from "../domain/security/LoginAttemptTracker.js";
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

	if ("wrongPassword" in profile && profile.wrongPassword) {
		await handleWrongNativePassword(profile.id, loginTracker, ipAddress);
	}

	return profile as User;
}

export function requiresOrgSelection(user: User, orgId: string | undefined): boolean {
	return Boolean(user.orgMemberships?.length && orgId === undefined);
}

async function handleWrongNativePassword(userId: string, loginTracker: LoginAttemptTracker, ipAddress: string): Promise<never> {
	const blockStatus = await loginTracker.recordLoginAttempt(userId, false, ipAddress);

	if (blockStatus.blocked) {
		if (blockStatus.permanent) {
			throw new AuthError(403, "ACCOUNT_BLOCKED_PERMANENT", "Cuenta bloqueada");
		}

		throw new AuthError(403, "ACCOUNT_BLOCKED_TEMP", "Cuenta bloqueada temporalmente", {
			blockedUntil: blockStatus.blockedUntil ?? undefined,
		});
	}

	throw new AuthError(401, "INVALID_CREDENTIALS", "Credenciales inválidas");
}
