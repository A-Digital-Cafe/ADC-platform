import { Type } from "@sinclair/typebox";

/**
 * Schemas TypeBox compartidos por los endpoints de IdentityManagerService.
 * Alimentan la validación de entrada (runtime) y el doc OpenAPI en `/api/docs`.
 */

/** Respuesta genérica de operación exitosa (`{ success: true }`). */
export const SuccessResponse = Type.Object(
	{ success: Type.Boolean() },
	{ description: "Operación completada con éxito" }
);

/** Permiso basado en bitfields (resource/action/scope). */
export const PermissionInput = Type.Object(
	{
		resource: Type.String({ description: 'Recurso objetivo (ej. "identity")' }),
		action: Type.Integer({ description: "Bitfield de acciones (READ | WRITE | …)" }),
		scope: Type.Integer({ description: "Bitfield de scopes (USERS | GROUPS | …)" }),
	},
	{ description: "Permiso basado en bitfields" }
);

/** Query opcional para filtrar por organización (solo admin global). */
export const OrgIdQuery = Type.Object({
	orgId: Type.Optional(Type.String({ description: "Filtra por organización (solo admin global)" })),
});

/** Respuesta 202 de endpoints encolados (`enqueue: true`). */
export const JobAcceptedResponse = Type.Object(
	{
		jobId: Type.String({ description: "Identificador del job para polling" }),
		status: Type.Literal("queued"),
		pollUrl: Type.String({ description: "URL para consultar el estado: GET /api/jobs/:jobId" }),
	},
	{ description: "Operación encolada; consultar estado vía pollUrl" }
);
