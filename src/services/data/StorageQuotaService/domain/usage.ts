import { Schema } from "mongoose";
import type { QuotaSubject, StorageAppUsage } from "@common/types/storage/quota.ts";

/**
 * Contadores de uso de almacenamiento. Un documento por (usuario, contexto):
 * `_id = "<userId>|<orgId>"` (orgId vacío = personal), con `userId`/`orgId`
 * denormalizados para agregados por org. El `_id` compuesto preserva el
 * incremento condicional atómico (mínimo por app O límite total) en un único
 * `updateOne`. Asume que `userId` no contiene `|` (IDs de Identity).
 */
export interface StorageUsageDoc {
	_id: string;
	userId: string;
	orgId: string | null;
	totalBytes: number;
	totalCount: number;
	apps: Map<string, StorageAppUsage>;
	updatedAt: Date;
}

/** Única fuente del formato de key del documento de uso. */
export function usageDocId(subject: QuotaSubject): string {
	return `${subject.userId}|${subject.orgId ?? ""}`;
}

export const storageUsageSchema = new Schema<StorageUsageDoc>(
	{
		_id: { type: String, required: true },
		userId: { type: String, required: true, index: true, maxlength: 64 },
		orgId: { type: String, default: null, index: true, maxlength: 80 },
		totalBytes: { type: Number, required: true, default: 0, min: 0 },
		totalCount: { type: Number, required: true, default: 0, min: 0 },
		apps: {
			type: Map,
			of: new Schema<StorageAppUsage>(
				{
					bytes: { type: Number, required: true, default: 0, min: 0 },
					count: { type: Number, required: true, default: 0, min: 0 },
				},
				{ _id: false }
			),
			default: () => new Map(),
		},
		updatedAt: { type: Date, default: Date.now },
	},
	{ id: false, versionKey: false }
);
