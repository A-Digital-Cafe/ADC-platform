/**
 * Contrato público del **SessionManagerService** (clase principal).
 *
 * Vive en `@common` para que apps y servicios consuman la sesión por **interfaz**
 * sin importar la clase concreta de `@services`. La clase concreta hace
 * `implements ISessionManagerService`.
 */

import type { TokenVerificationResult } from "@services/security/SessionManagerService/types.js";
import type { CapabilityToken } from "@common/security/Capability.ts";

export interface ISessionManagerService {
	/** Verifica un token de sesión y resuelve el usuario/permisos actuales. */
	verifyToken(token: string): Promise<TokenVerificationResult>;
	/** Login server-side que devuelve un token de sesión. Requiere capability `session:programmatic`. */
	loginProgrammatic(cap: CapabilityToken, username: string, password: string): Promise<string | null>;
	/** Extrae el token de sesión de las cookies de una request. */
	extractSessionToken(req: { cookies?: Record<string, string> }): string | null;
}
