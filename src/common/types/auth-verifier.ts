import { AuthorizationError } from "./custom-errors/AuthorizationError.ts";

interface HasPermissionOpts {
	/** ID del owner del recurso; usado para evaluar el bit `SELF`. */
	ownerId?: string;
}

export interface IAuthVerifier {
	verifyToken(token: string): Promise<{ valid: boolean; userId?: string; orgId?: string; error?: string }>;
	hasPermission(userId: string, action: number, scope: number, orgId?: string, resource?: string, opts?: HasPermissionOpts): Promise<boolean>;
}

export type AuthVerifierGetter = () => IAuthVerifier | null;

interface RequirePermissionOpts {
	orgId?: string;
	ownerId?: string;
	/**
	 * Vía alternativa: si retorna `true`, concede acceso sin chequear el permiso formal.
	 * Recibe el `userId` verificado y el contexto de autenticación resuelto del token
	 * (ej. `orgId` cuando el token pertenece a una organización).
	 */
	allowIf?: (userId: string, authCtx: { orgId?: string }) => boolean | Promise<boolean>;
}

export class PermissionChecker {
	constructor(
		private readonly getAuthVerifier: AuthVerifierGetter,
		private readonly managerName: string,
		private readonly resource: string
	) {}

	async requirePermission(token: string | undefined, action: number, scope: number, opts?: RequirePermissionOpts | string): Promise<string> {
		// Compat con firma antigua `(token, action, scope, orgId)`.
		const options: RequirePermissionOpts = typeof opts === "string" ? { orgId: opts } : (opts ?? {});

		const authVerifier = this.getAuthVerifier();
		if (!authVerifier) return "";
		if (!token) {
			throw new AuthorizationError(`[${this.managerName}] Token de autenticación requerido`, "NO_TOKEN");
		}
		const result = await authVerifier.verifyToken(token);
		if (!result.valid || !result.userId) {
			throw new AuthorizationError(result.error || "Token inválido", "INVALID_TOKEN");
		}

		if (options.allowIf) {
			try {
				// Contrato estricto: solo concede si retorna EXACTAMENTE `true` y el userId
				// verificado es un string no vacío (evita bypass por valores truthy accidentales
				// o comparaciones undefined === undefined en los callbacks).
				const granted = await options.allowIf(result.userId, { orgId: result.orgId });
				if (granted === true && result.userId.trim().length > 0) return result.userId;
			} catch {
				// Si allowIf falla, continuamos al chequeo de permiso formal.
			}
		}

		const effectiveOrgId = options.orgId ?? result.orgId;
		const hasPermission = await authVerifier.hasPermission(result.userId, action, scope, effectiveOrgId, this.resource, {
			ownerId: options.ownerId,
		});
		if (!hasPermission) {
			throw new AuthorizationError(
				`Usuario ${result.userId} no tiene permisos (resource=${this.resource}, action=${action}, scope=${scope})`,
				"FORBIDDEN"
			);
		}
		return result.userId;
	}

	async resolveUserId(token: string | undefined): Promise<string> {
		const authVerifier = this.getAuthVerifier();
		if (!authVerifier) return "";
		if (!token) {
			throw new AuthorizationError(`[${this.managerName}] Token requerido`, "NO_TOKEN");
		}
		const result = await authVerifier.verifyToken(token);
		if (!result.valid || !result.userId) {
			throw new AuthorizationError(result.error || "Token inválido", "INVALID_TOKEN");
		}
		return result.userId;
	}
}
