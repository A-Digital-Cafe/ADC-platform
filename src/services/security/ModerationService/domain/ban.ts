import { Schema } from "mongoose";
import type { BanRecord } from "@common/types/identity/Moderation.js";

/** Retención del registro tras levantarse el bloqueo: 6 meses (configurable por `private.retention`). */
export const DEFAULT_BAN_RETENTION_DAYS = 180;

export function buildBanSchema(retentionSeconds: number): Schema<BanRecord> {
	// Los índices no se crean acá sino con `syncIndexes()` en el arranque del servicio:
	// cambiar el plazo de retención cambia las opciones del TTL, y el autoIndex de mongoose
	// abortaría con IndexOptionsConflict en vez de recrearlo.
	const schema = new Schema<BanRecord>(
		{
			id: { type: String, required: true, unique: true },
			emailHashes: { type: [String], default: [], index: true },
			emailMasks: { type: [String], default: [] },
			ipHashes: { type: [String], default: [], index: true },
			reason: { type: String, default: "" },
			lastLoginAt: { type: Date, default: null },
			bannedAt: { type: Date, required: true, default: () => new Date() },
			expiresAt: { type: Date, default: null, index: true },
			source: { type: String, required: true, default: "manual" },
			externalId: { type: String, index: true, sparse: true },
			userId: { type: String, index: true, sparse: true },
			active: { type: Boolean, default: true, index: true },
			unbannedAt: { type: Date },
			unbanReason: { type: String },
		},
		{ id: false, versionKey: false, autoIndex: false }
	);

	// Composite index para deduplicar por origen externo (idempotencia con modlogs)
	schema.index({ source: 1, externalId: 1 }, { unique: false, sparse: true });

	// Retención: Mongo borra el registro pasado el plazo desde que se desactivó. Los bans
	// vigentes no tienen `unbannedAt` y un TTL sobre un campo ausente no expira nada, así que
	// el barrido que desactiva los vencidos es lo que los hace entrar acá.
	schema.index({ unbannedAt: 1 }, { expireAfterSeconds: retentionSeconds });

	return schema;
}
