export { AuthError } from "@common/types/custom-errors/AuthError.js";
import type { SessionUser, SessionResponse } from "@common/types/identity/Session.js";
import { createAdcApi, type RequestOptions } from "@ui-library/utils/adc-fetch";

/** @deprecated Usa SessionUser directamente. */
export type AuthUser = SessionUser;

export type { SessionUser, SessionResponse };

export interface OrgOption {
	orgId: string;
	slug: string;
}

export interface AuthResponse {
	success: boolean;
	user?: SessionUser;
	error?: string;
	/** Indica que el usuario debe seleccionar una organización antes de concretar el login */
	requiresOrgSelection?: boolean;
	userId?: string;
	username?: string;
	orgOptions?: OrgOption[];
}

/** Error data returned when account is blocked */
export interface BlockedErrorData {
	blockedUntil?: number;
}

/**
 * Auth API client using createAdcApi
 * - same-origin credentials (cookies sent only to same domain)
 * - Automatic error handling via adc-custom-error
 */
const api = createAdcApi({
	basePath: "/api/auth",
	devPort: 3000,
	credentials: process.env.NODE_ENV === "development" ? "include" : "same-origin",
});

export const authApi = {
	/**
	 * Login nativo con username/password
	 * Si el usuario tiene orgs, puede retornar requiresOrgSelection con las opciones.
	 * En ese caso, llamar de nuevo con orgId para completar el login.
	 * @param options - Request options (e.g., translateParams for blocked time formatting)
	 */
	login: (username: string, password: string, options?: Pick<RequestOptions<BlockedErrorData>, "translateParams">, orgId?: string | null) =>
		api.post<AuthResponse, BlockedErrorData>("/login", {
			body: { username, password, ...(orgId !== undefined ? { orgId } : {}) },
			...options,
		}),

	/**
	 * Registro de nuevo usuario
	 */
	register: (username: string, email: string, password: string) =>
		api.post<AuthResponse>("/register", { body: { username, email, password }, idempotencyKey: username }),

	/**
	 * Obtener sesión actual
	 */
	getSession: () => api.get<SessionResponse>("/session"),

	/**
	 * Cerrar sesión
	 */
	logout: () => api.post("/logout"),

	/**
	 * Refrescar tokens
	 */
	refresh: () => api.post("/refresh"),

	/**
	 * Vincular cuenta OAuth pendiente con una cuenta local existente.
	 */
	linkAccount: (password: string) => api.post<AuthResponse>("/link-account", { body: { password } }),

	/**
	 * Cambiar contexto de organización (re-emite tokens)
	 * @param orgId - ID de la organización o undefined para acceso personal
	 */
	switchOrg: (orgId?: string) => api.post<AuthResponse>("/switch-org", { body: { orgId } }),

	/**
	 * Obtener organizaciones del usuario autenticado
	 */
	getUserOrgs: () => api.get<{ orgs: OrgOption[]; currentOrgId?: string }>("/user-orgs"),
};
