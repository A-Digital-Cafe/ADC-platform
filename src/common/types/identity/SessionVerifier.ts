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
}
