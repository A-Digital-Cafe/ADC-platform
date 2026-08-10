import type { SessionUser, SessionResponse } from "@common/types/identity/Session.js";
import { createAdcApi, type RequestOptions } from "@ui-library/utils/adc-fetch";
import { createClientId } from "@common/utils/client-crypto.js";

export type { SessionResponse };

export interface OrgOption {
	orgId: string;
	slug: string;
}

/** Aceptación de Términos y Privacidad + autodeclaración de edad, tal como la envía el formulario. */
export interface LegalAcceptanceInput {
	acceptedTerms: boolean;
	ageConfirmed: boolean;
	termsVersion: string;
	privacyVersion: string;
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
			body: { username, password, ...(orgId === undefined ? {} : { orgId }) },
			...options,
		}),

	/**
	 * Registro de nuevo usuario.
	 *
	 * `legal` viaja con la versión de los documentos que el formulario mostró: el servidor la
	 * compara con la vigente y rechaza el alta si no coinciden (pestaña vieja tras una
	 * actualización). Así la constancia guardada prueba qué texto se aceptó, no sólo que se aceptó.
	 *
	 * La clave de idempotencia es un id fresco por intento, como en el resto de los clientes: con el
	 * username, dos intentos seguidos con el mismo nombre replicaban la respuesta cacheada del
	 * primero — y ahora que el alta responde siempre lo mismo, eso taparía el segundo intento real.
	 */
	register: (username: string, email: string, password: string, legal: LegalAcceptanceInput) =>
		api.post<AuthResponse>("/register", { body: { username, email, password, legal }, idempotencyKey: createClientId() }),

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

/** API pública de identidad para canjear tokens que llegan por email (sin sesión). */
const identityApi = createAdcApi({
	basePath: "/api/identity",
	devPort: 3000,
});

export const identityPublicApi = {
	/**
	 * Canje del token de arrepentimiento (`/cancel-deletion?token=…`). El backend responde 400
	 * INVALID_CANCEL_TOKEN ante cualquier fallo; `silent` porque la página muestra su propio
	 * estado en vez del toast global.
	 */
	cancelDeletion: (token: string) =>
		identityApi.post<{ success: boolean }>("/users/cancel-deletion", {
			body: { token },
			idempotencyKey: createClientId(),
			silent: true,
		}),

	/**
	 * Canje del token de confirmación del cambio de email (`/confirm-email?token=…`).
	 * Un solo uso, 60 min de vigencia; 409 EMAIL_EXISTS si la dirección se registró
	 * en otra cuenta entre pedido y canje.
	 */
	confirmEmailChange: (token: string) =>
		identityApi.post<{ success: boolean }>("/users/confirm-email-change", {
			body: { token },
			idempotencyKey: createClientId(),
			silent: true,
		}),
};
