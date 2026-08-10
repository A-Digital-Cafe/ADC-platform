import ADCCustomError, { type ADCCustomErrorJSON } from "../ADCCustomError.ts";

type IdentityErrorTypes =
	// Access / org isolation
	| "ORG_ACCESS_DENIED"
	| "GLOBAL_ONLY"
	| "CROSS_ORG_ROLE"
	| "CROSS_ORG_USER"
	| "CROSS_ORG_GROUP"
	| "CANNOT_MODIFY_PREDEFINED"
	| "CANNOT_DELETE_PREDEFINED"
	| "FORBIDDEN_FIELD"
	// Jerarquía de roles
	| "CANNOT_MODIFY_SELF"
	| "HIERARCHY_VIOLATION"
	| "GLOBAL_ONLY_RESOURCE"
	// Se intentó otorgar un permiso que el actor no posee
	| "PERMISSION_ESCALATION"
	// Planes / asientos
	| "SEAT_LIMIT_REACHED"
	| "USER_NOT_FOUND"
	| "ROLE_NOT_FOUND"
	| "GROUP_NOT_FOUND"
	| "ORG_NOT_FOUND"
	| "REGION_NOT_FOUND"
	| "AVATAR_NOT_FOUND"
	// Avatares
	| "AVATAR_UPLOAD_UNAVAILABLE"
	| "NO_CUSTOM_AVATAR"
	| "INVALID_PROVIDER"
	| "INVALID_SOURCE"
	// Baja de cuenta programada
	| "AUDIT_UNAVAILABLE"
	| "INVALID_CANCEL_TOKEN"
	| "NOT_CANCELLABLE"
	// Reactivación por PUT bloqueada: una cuenta baneada sólo vuelve por el flujo de unban
	| "USER_BANNED"
	// Export de datos personales (1 cada 24 h; `data.retryAfterSeconds` alimenta el Retry-After)
	| "EXPORT_RATE_LIMITED"
	// Rectificación self-service (art. 16 Ley 25.326 / art. 16 RGPD)
	| "INVALID_EMAIL_CHANGE_TOKEN"
	| "EMAIL_DELIVERY_UNAVAILABLE"
	// El despliegue no entrega correo afuera: una casilla externa no se puede verificar todavía
	| "EXTERNAL_EMAIL_UNAVAILABLE"
	// El buzón de plataforma que tomaría el username nuevo ya es de otro titular
	| "MAILBOX_ADDRESS_TAKEN"
	// Cooldown de 30 días entre cambios de username; `data.retryAfterSeconds` alimenta el Retry-After
	| "USERNAME_CHANGE_COOLDOWN"
	// Validation
	| "FORBIDDEN"
	| "INVALID_BODY"
	| "MISSING_FIELDS"
	| "MISSING_TARGET"
	| "INVALID_REASON"
	| "INVALID_ROLE"
	| "INVALID_ROLE_ID"
	| "INVALID_GROUP"
	| "INVALID_FIELD"
	| "INVALID_PERMISSION";

export class IdentityError extends ADCCustomError<Record<string, unknown>, IdentityErrorTypes> {
	public readonly name = "IdentityError";
}

/**
 * @public
 */
export type ADCIdentityErrorJSON = ADCCustomErrorJSON<Record<string, unknown>, IdentityErrorTypes>;
