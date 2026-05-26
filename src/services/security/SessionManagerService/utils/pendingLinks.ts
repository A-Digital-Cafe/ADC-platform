import { AuthError } from "@common/types/custom-errors/AuthError.ts";
import type { UserAuthenticationResult } from "../../../core/IdentityManagerService/dao/users.ts";

export interface PendingLinkEntry<TData> {
	data: TData;
	createdAt: number;
	expiresAt: number;
	attempts: number;
}

interface PendingPasswordOptions<TData> {
	pendingToken: string;
	entry: PendingLinkEntry<TData>;
	username: string;
	password: string;
	maxAttempts: number;
	authenticate: (username: string, password: string) => Promise<UserAuthenticationResult>;
	storePendingLink: (token: string, entry: PendingLinkEntry<TData>) => Promise<void>;
	deletePendingLink: (token: string) => Promise<void>;
}

export function requirePendingLinkToken(pendingToken: string | undefined): string {
	if (!pendingToken) {
		throw new AuthError(400, "NO_PENDING_LINK", "No hay vinculación pendiente");
	}
	return pendingToken;
}

export async function requireValidPendingLinkEntry<TData>(
	pendingToken: string,
	entry: PendingLinkEntry<TData> | null,
	deletePendingLink: (token: string) => Promise<void>
): Promise<PendingLinkEntry<TData>> {
	if (!entry) {
		throw new AuthError(400, "INVALID_PENDING_LINK", "Vinculación expirada o inválida");
	}

	if (Date.now() > entry.expiresAt) {
		await deletePendingLink(pendingToken);
		throw new AuthError(400, "INVALID_PENDING_LINK", "Vinculación expirada");
	}

	return entry;
}

export function requirePendingLinkPassword(data: { password?: string } | undefined): string {
	const { password } = data || {};
	if (!password) {
		throw new AuthError(400, "PASSWORD_REQUIRED", "Se requiere contraseña para vincular la cuenta");
	}
	return password;
}

export async function assertPendingLinkPassword<TData>(options: PendingPasswordOptions<TData>): Promise<void> {
	const authResult = await options.authenticate(options.username, options.password);

	if (isWrongPassword(authResult)) {
		await handleWrongPassword(options);
	}

	if (authResult && "isActive" in authResult && !authResult.isActive) {
		await options.deletePendingLink(options.pendingToken);
		throw new AuthError(403, "ACCOUNT_DISABLED", "Cuenta deshabilitada");
	}
}

function isWrongPassword(authResult: UserAuthenticationResult): authResult is null | { id: string; wrongPassword: boolean } {
	return !authResult || ("wrongPassword" in authResult && authResult.wrongPassword);
}

async function handleWrongPassword<TData>(options: PendingPasswordOptions<TData>): Promise<never> {
	options.entry.attempts++;

	if (options.entry.attempts >= options.maxAttempts) {
		await options.deletePendingLink(options.pendingToken);
		throw new AuthError(401, "WRONG_PASSWORD", "Demasiados intentos fallidos, inicie el proceso nuevamente");
	}

	await options.storePendingLink(options.pendingToken, options.entry);
	throw new AuthError(401, "WRONG_PASSWORD", `Contraseña incorrecta (${options.maxAttempts - options.entry.attempts} intentos restantes)`);
}
