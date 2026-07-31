import { Schema } from "mongoose";

/**
 * Contador de consumo por (sujeto, feature, ventana, período).
 *
 * `_id = "<userId>|<orgId>|<featureKey>|<window>|<period>"`. El reset es
 * **implícito**: al rotar el período cambia el `_id` y el contador arranca en 0,
 * sin cron de limpieza. Mismo diseño que el `UsageManager` del image-editor,
 * generalizado a cualquier módulo.
 */
export interface UsageCounterDoc {
	_id: string;
	count: number;
	updatedAt: Date;
}

export const usageCounterSchema = new Schema<UsageCounterDoc>(
	{
		_id: { type: String, required: true },
		count: { type: Number, required: true, default: 0, min: 0 },
		updatedAt: { type: Date, default: Date.now },
	},
	{ _id: false, versionKey: false }
);

/** Clave del contador. `orgId` nulo = contexto personal. */
export function counterId(userId: string, orgId: string | null, featureKey: string, window: string, period: string): string {
	return `${userId}|${orgId ?? ""}|${featureKey}|${window}|${period}`;
}
