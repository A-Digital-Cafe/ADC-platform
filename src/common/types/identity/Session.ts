import type { LinkedAccount } from "./User.js";
import type { Permission } from "./Permission.js";

/**
 * Representación del usuario autenticado en sesiones frontend.
 * Fuente única de verdad para session.ts, auth.ts y adc-access-button.
 */
export interface SessionUser {
	id: string;
	username: string;
	email?: string;
	avatar?: string;
	perms?: Permission[];
	/** Nombres de los roles vigentes en el contexto (personal u organización). */
	roles?: string[];
	orgId?: string;
	orgSlug?: string;
	linkedAccounts?: LinkedAccount[];
	isAdmin?: boolean;
	isOrgAdmin?: boolean;
	groupIds?: string[];
}

/**
 * Respuesta del endpoint GET /api/auth/session.
 */
export interface SessionResponse {
	authenticated: boolean;
	user?: SessionUser;
	expiresAt?: number;
	error?: string;
}
