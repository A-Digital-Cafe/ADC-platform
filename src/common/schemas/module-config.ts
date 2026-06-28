/**
 * Schema **lenient** para el `config.json` / `default.json` de un módulo
 * (app/service/provider/utility), correspondiente a `IModuleConfig`.
 *
 * Objetivo: validar el *envelope* de la configuración leída de disco antes de
 * usarla en la carga de módulos. No busca ser exhaustivo (los configs admiten
 * claves arbitrarias, de ahí `additionalProperties: true`); valida lo que el
 * kernel realmente lee para convertir un config corrupto/typo en un error claro
 * y temprano en vez de un fallo difuso aguas abajo:
 *  - que el JSON sea un objeto (no un array, primitivo o `null`);
 *  - que las listas de dependencias (`providers`/`utilities`/`services`) sean
 *    arrays si están presentes;
 *  - que los campos escalares conocidos tengan el tipo correcto.
 */
import { Type } from "@sinclair/typebox";
import { compileSchema } from "../utils/json-schema.ts";

const ModuleConfigSchema = Type.Object(
	{
		name: Type.Optional(Type.String()),
		type: Type.Optional(Type.String()),
		version: Type.Optional(Type.String()),
		language: Type.Optional(Type.String()),
		global: Type.Optional(Type.Boolean()),
		failOnError: Type.Optional(Type.Boolean()),
		kernelMode: Type.Optional(Type.Union([Type.Boolean(), Type.Number()])),
		privileges: Type.Optional(Type.Array(Type.String())),
		// Las listas de dependencias y los blobs de config se validan como
		// array/objeto (forma) pero con elementos `Any`: el contenido anidado lo
		// consume el cargador con su propio tipado, sin fricción aquí.
		providers: Type.Optional(Type.Array(Type.Any())),
		utilities: Type.Optional(Type.Array(Type.Any())),
		services: Type.Optional(Type.Array(Type.Any())),
		custom: Type.Optional(Type.Record(Type.String(), Type.Any())),
		private: Type.Optional(Type.Record(Type.String(), Type.Any())),
	},
	{ additionalProperties: true }
);

/** Validador compilado (reutilizable) del config de módulo. */
export const moduleConfigCheck = compileSchema(ModuleConfigSchema);
