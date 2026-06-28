import { Type } from "@sinclair/typebox";
import { compileSchema } from "@common/utils/json-schema.ts";

/**
 * Validador del `JobStatus` persistido en Redis para operaciones async
 * (encoladas). Espeja la interfaz `JobStatus` de `../types.ts`; `result` es
 * deliberadamente `Unknown` (carga arbitraria). Garantiza que lo leído de Redis
 * tenga forma de job antes de devolverlo al cliente o actualizarlo.
 */
export const jobStatusCheck = compileSchema(
	Type.Object({
		status: Type.Union([Type.Literal("queued"), Type.Literal("processing"), Type.Literal("completed"), Type.Literal("failed")]),
		endpoint: Type.String(),
		userId: Type.Optional(Type.String()),
		result: Type.Optional(Type.Unknown()),
		error: Type.Optional(Type.String()),
		createdAt: Type.String(),
		completedAt: Type.Optional(Type.String()),
	})
);
