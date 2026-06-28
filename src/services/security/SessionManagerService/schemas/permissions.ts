import { Type } from "@sinclair/typebox";
import { compileSchema } from "@common/utils/json-schema.ts";

/**
 * Validador del cache de permisos en Redis (`session:permfp:*`): una lista de
 * strings y nada más. Evita que un cache corrupto se propague a decisiones de
 * autorización.
 */
export const permissionStringsCheck = compileSchema(Type.Array(Type.String()));
