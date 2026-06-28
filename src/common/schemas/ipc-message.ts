import { Type } from "@sinclair/typebox";
import { compileSchema } from "../utils/json-schema.ts";

/**
 * Validador del *envelope* de un mensaje IPC recibido por el socket entre
 * procesos del kernel. `args`/`result` son deliberadamente `Unknown` (cargan
 * datos arbitrarios, p.ej. buffers en base64); lo que se valida es la forma del
 * sobre: `id` string y `type` dentro de la unión conocida, para descartar
 * mensajes malformados antes de despacharlos a un handler.
 */
export const ipcMessageCheck = compileSchema(
	Type.Object({
		id: Type.String(),
		type: Type.Union([Type.Literal("request"), Type.Literal("response"), Type.Literal("error")]),
		method: Type.Optional(Type.String()),
		args: Type.Optional(Type.Array(Type.Unknown())),
		result: Type.Optional(Type.Unknown()),
		error: Type.Optional(Type.String()),
	})
);
