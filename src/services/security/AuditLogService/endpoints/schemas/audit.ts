import { Type } from "@sinclair/typebox";

/** Schemas TypeBox del endpoint de consulta del audit log (AuditLogService). */

export const AuditListQuery = Type.Object({
	limit: Type.Optional(Type.String({ pattern: String.raw`^\d+$`, description: "Tamaño de página (máx. 200, por defecto 50)" })),
	cursor: Type.Optional(Type.String({ description: "`nextCursor` de la página anterior (`<atISO>|<id>`)" })),
	action: Type.Optional(Type.String({ maxLength: 200, description: "Filtro exacto por acción (ej. `drive.recover-deleted`)" })),
	actorUserId: Type.Optional(Type.String({ maxLength: 200, description: "Filtro exacto por actor" })),
	targetUserId: Type.Optional(Type.String({ maxLength: 200, description: "Filtro exacto por usuario afectado" })),
});

const AuditContextValue = Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()]);

const AuditEntry = Type.Object({
	id: Type.String(),
	at: Type.String({ format: "date-time" }),
	origin: Type.String({ description: "Módulo productor (sale de su capability, no es falsificable)" }),
	action: Type.String(),
	actorUserId: Type.String(),
	actorRoles: Type.Optional(Type.Array(Type.String())),
	targetUserId: Type.Optional(Type.String()),
	targetResource: Type.Optional(Type.String()),
	context: Type.Optional(Type.Record(Type.String(), AuditContextValue, { description: "Solo IDs/contadores/flags; saneado al escribir" })),
});

export const AuditListResponse = Type.Object({
	items: Type.Array(AuditEntry, { description: "De la más nueva a la más vieja" }),
	nextCursor: Type.Union([Type.String(), Type.Null()], { description: "`<atISO>|<id>` desde donde seguir; `null` si no hay más" }),
});
