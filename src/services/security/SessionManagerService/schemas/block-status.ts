import { Type, type Static } from "@sinclair/typebox";
import { compileSchema } from "@common/utils/json-schema.ts";

/**
 * Estado de bloqueo de un usuario tal como se persiste en Redis. El schema es la
 * fuente única del tipo y del validador con el que se valida lo leído antes de
 * usarlo para decidir si un usuario está bloqueado.
 */
const UserBlockStatusSchema = Type.Object({
	blocked: Type.Boolean(),
	blockedUntil: Type.Union([Type.Number(), Type.Null()]),
	permanent: Type.Boolean(),
	reason: Type.String(),
});

export const userBlockStatusCheck = compileSchema(UserBlockStatusSchema);

export type UserBlockStatus = Static<typeof UserBlockStatusSchema>;
