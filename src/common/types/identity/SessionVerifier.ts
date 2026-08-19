/**
 * Contrato mínimo de verificación de sesión (A-04).
 *
 * `EndpointManagerService` (y cualquier otro consumidor) depende de esta
 * interfaz en lugar de la clase concreta `SessionManagerService`, reduciendo
 * acoplamiento y ciclos de import entre servicios. `SessionManagerService` la
 * implementa (`implements ISessionVerifier`).
 */

interface VerifiedSessionUser {
	id: string;
	username: string;
	email?: string;
	avatar?: string;
	permissions: string[];
	orgId?: string;
	metadata?: Record<string, unknown>;
}

interface SessionVerificationResult {
	valid?: boolean;
	error?: string;
	/** Si se verificó con clave anterior (requiere refresh) */
	usedPreviousKey?: boolean;
	session?: {
		user: VerifiedSessionUser;
		expiresAt?: number | string | Date;
	};
}

export interface ISessionVerifier {
	/** Valida autenticidad/expiración del token y devuelve la sesión asociada. */
	verifyToken(token: string): Promise<SessionVerificationResult>;
	/** Extrae el token de sesión de las cookies del request (o null). */
	extractSessionToken(req: { cookies?: Record<string, string> }): string | null;
	/** Nombres de los roles vigentes del usuario en su contexto (personal u organización). */
	resolveRoles(userId: string, orgId?: string): Promise<string[]>;
	/**
	 * Catálogo de nombres de rol que existen (predefinidos + propios). Sólo para validar
	 * configuración: lista vacía = no se pudo consultar, así que el llamador no debe concluir
	 * nada de un catálogo vacío.
	 */
	listRoleNames(): Promise<string[]>;
}
