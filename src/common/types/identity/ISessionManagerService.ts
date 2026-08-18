/**
 * Contrato público del **SessionManagerService** (clase principal).
 *
 * Vive en `@common` para que apps y servicios consuman la sesión por **interfaz**
 * sin importar la clase concreta del preset `IAM`. La clase concreta hace
 * `implements ISessionManagerService`.
 *
 * Extiende `ISessionVerifier` en vez de repetir `verifyToken`/`extractSessionToken`: el resultado
 * de verificación se declara una sola vez, ahí.
 */

import type { ISessionVerifier } from "./SessionVerifier.ts";
import type { CapabilityToken } from "@common/security/Capability.ts";

export interface ISessionManagerService extends ISessionVerifier {
	/** Login server-side que devuelve un token de sesión. Requiere capability `session:programmatic`. */
	loginProgrammatic(cap: CapabilityToken, username: string, password: string): Promise<string | null>;
	/**
	 * Revoca todos los refresh tokens del usuario: sus sesiones dejan de poder renovarse y
	 * mueren cuando expire el access token vigente. Requiere capability `session:revoke`.
	 *
	 * @returns Cantidad de tokens revocados.
	 */
	revokeUserSessions(cap: CapabilityToken, userId: string): Promise<number>;
}
