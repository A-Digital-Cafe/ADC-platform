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

/** `verify` = presentar un código; `enroll` = darlo de alta ahora (obligatorio por rol). */
export type TwoFactorMode = "verify" | "enroll";

export interface AuthResponse {
	success: boolean;
	user?: SessionUser;
	error?: string;
	/** Destino post-vinculación resuelto por el backend (returnUrl validado o default) */
	redirectUrl?: string;
	/** Indica que el usuario debe seleccionar una organización antes de concretar el login */
	requiresOrgSelection?: boolean;
	/** El login quedó pendiente del segundo factor: continuar por `twoFactorApi`. */
	requires2fa?: boolean;
	mode?: TwoFactorMode;
	userId?: string;
	username?: string;
	orgOptions?: OrgOption[];
	/** Sólo al completar el alta obligatoria: se muestran una vez y no se vuelven a servir. */
	recoveryCodes?: string[];
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

/**
 * Segundo factor del login. Todas las llamadas se apoyan en la cookie httpOnly del desafío que
 * plantó el paso anterior; no hay identificador que el cliente tenga que llevar ni pueda tocar.
 *
 * `silent` en ningún caso: los errores (código incorrecto, desafío vencido) se muestran con el
 * callout declarativo de la página, igual que en el resto del flujo de login.
 */
export const twoFactorApi = {
	/** Qué espera el desafío vigente. Lo usa el flujo OAuth, que llega por redirect sin contexto. */
	getChallenge: () => api.get<{ mode: TwoFactorMode; username: string; expiresAt: number; attemptsLeft: number }>("/login/2fa"),

	/** Completa el login con un código del autenticador o de recuperación. */
	verify: (code: string) => api.post<AuthResponse>("/login/2fa", { body: { code } }),

	/** Alta obligatoria: pide el secreto nuevo. El QR se arma en el cliente con `otpauthUri`. */
	startEnrollment: () => api.post<{ secret: string; otpauthUri: string }>("/login/2fa/enroll"),

	/** Confirma el alta obligatoria: activa el factor, emite la sesión y devuelve los códigos. */
	confirmEnrollment: (code: string) => api.post<AuthResponse>("/login/2fa/enroll/confirm", { body: { code } }),
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
