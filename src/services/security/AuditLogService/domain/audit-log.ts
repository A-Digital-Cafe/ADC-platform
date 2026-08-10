import { Schema } from "mongoose";
import type { AuditLogRecord } from "@common/types/security/AuditLog.ts";

/**
 * Schema de la colección `audit_log`. Los índices se aplican con `syncIndexes()` en el arranque y
 * no por autoIndex: cambiar la retención cambia las opciones del TTL y autoIndex abortaría con
 * IndexOptionsConflict en vez de recrearlo.
 */
export function buildAuditLogSchema(retentionSeconds: number): Schema<AuditLogRecord> {
	const schema = new Schema<AuditLogRecord>(
		{
			id: { type: String, required: true, unique: true },
			at: { type: Date, required: true, default: () => new Date() },
			origin: { type: String, required: true },
			action: { type: String, required: true },
			actorUserId: { type: String, required: true },
			actorRoles: { type: [String], default: undefined },
			targetUserId: { type: String, default: undefined },
			targetResource: { type: String, default: undefined },
			context: { type: Object, default: undefined },
		},
		{ id: false, versionKey: false, autoIndex: false, collection: "audit_log" }
	);

	// Página admin (at desc, id desc) + filtros exactos frecuentes.
	schema.index({ at: -1, id: -1 });
	schema.index({ action: 1, at: -1 });
	schema.index({ actorUserId: 1, at: -1 });
	schema.index({ targetUserId: 1, at: -1 }, { sparse: true });

	// Retención (accountability): Mongo borra la entrada pasado el plazo desde `at`.
	schema.index({ at: 1 }, { expireAfterSeconds: retentionSeconds });

	return schema;
}
