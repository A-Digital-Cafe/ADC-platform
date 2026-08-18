import { TypeCompiler, type TypeCheck } from "@sinclair/typebox/compiler";
import type { TSchema } from "@sinclair/typebox";
import { HttpError } from "@common/types/ADCCustomError.js";
import type { RegisteredEndpoint, EndpointCtx } from "../types.js";

/**
 * Validación de entrada declarativa con TypeBox (S-11).
 *
 * Los endpoints declaran schemas en `options.schema` usando `Type` de
 * `@sinclair/typebox`; aquí se compilan una sola vez al registrar el endpoint
 * y se validan en cada request ANTES de ejecutar el handler (400 homogéneo).
 * Los mismos schemas (JSON Schema estándar) alimentan el documento OpenAPI.
 *
 * @example options: { schema: { body: Type.Object({ email: Type.String({ format: "email" }) }) } }
 */

export interface CompiledEndpointSchemas {
	body?: TypeCheck<TSchema>;
	querystring?: TypeCheck<TSchema>;
	params?: TypeCheck<TSchema>;
}

function isTypeBoxSchema(value: unknown): value is TSchema {
	return typeof value === "object" && value !== null && Symbol.for("TypeBox.Kind") in value;
}

function compile(value: unknown): TypeCheck<TSchema> | undefined {
	if (!isTypeBoxSchema(value)) return undefined;
	return TypeCompiler.Compile(value);
}

/** Compila (una vez) los schemas TypeBox declarados en el endpoint. */
export function compileEndpointSchemas(endpoint: RegisteredEndpoint): CompiledEndpointSchemas | null {
	const schema = endpoint.options?.schema;
	if (!schema) return null;

	const compiled: CompiledEndpointSchemas = {
		body: compile(schema.body),
		querystring: compile(schema.querystring),
		params: compile(schema.params),
	};
	if (!compiled.body && !compiled.querystring && !compiled.params) return null;
	return compiled;
}

/**
 * Profundidad y cantidad de nodos máximas al buscar claves de operador. Acotadas para que un body
 * hostil profundamente anidado no cueste más que validarlo.
 */
const OPERATOR_SCAN_MAX_DEPTH = 12;
const OPERATOR_SCAN_MAX_NODES = 10_000;

/**
 * Rechaza claves de operador de MongoDB en la entrada del request.
 *
 * Sin esto, un body como `{"$set":{"passwordHash":"…"}}` pasa cualquier schema TypeBox (los
 * `Type.Object` no fijan `additionalProperties`), es invisible para los guards que inspeccionan
 * claves de primer nivel y mongoose lo reenvía tal cual a la base.
 *
 * Dos reglas distintas, a propósito:
 * - **`$` a cualquier profundidad**: ningún schema del repo declara propiedades que empiecen con `$`,
 *   así que no hay uso legítimo y conviene la red más amplia.
 * - **`.` sólo en el primer nivel**: una clave con punto en el primer nivel es una ruta de update
 *   (`{"permissions.0.resource": "*"}`), pero anidada es un valor legítimo — los records de
 *   `features`/`metadata`/`preferences` usan claves como `"drive.maxFileSize"` o `"storage.total"`.
 *
 * Esto es la primera de dos capas; la segunda es que los DAO construyan su `$set` desde una
 * allowlist en vez de spreadear el objeto del request.
 */
export function assertNoOperatorKeys(value: unknown, source: "body" | "query" | "params"): void {
	let nodes = 0;
	const walk = (node: unknown, depth: number, topLevel: boolean): void => {
		if (node === null || typeof node !== "object") return;
		if (depth > OPERATOR_SCAN_MAX_DEPTH || ++nodes > OPERATOR_SCAN_MAX_NODES) return;
		if (Array.isArray(node)) {
			// Los índices de un array no son claves de update: sus elementos siguen siendo primer nivel.
			for (const item of node) walk(item, depth + 1, topLevel);
			return;
		}
		for (const [key, child] of Object.entries(node)) {
			if (key.startsWith("$") || (topLevel && key.includes("."))) {
				throw new HttpError(400, "INVALID_INPUT", "Clave de operador no permitida en la petición", {
					issues: [{ path: `/${key}`, message: `La clave '${key}' no está permitida en ${source}` }],
				});
			}
			walk(child, depth + 1, false);
		}
	};
	walk(value, 0, true);
}

function firstErrors(check: TypeCheck<TSchema>, value: unknown, limit = 5): Array<{ path: string; message: string }> {
	const out: Array<{ path: string; message: string }> = [];
	for (const err of check.Errors(value)) {
		out.push({ path: err.path, message: err.message });
		if (out.length >= limit) break;
	}
	return out;
}

/** Valida params/query/body del request contra los schemas compilados. Lanza 400 con detalles. */
export function validateEndpointInput(compiled: CompiledEndpointSchemas, ctx: EndpointCtx<unknown, unknown>): void {
	if (compiled.params && !compiled.params.Check(ctx.params)) {
		throw new HttpError(400, "INVALID_PARAMS", "Parámetros de ruta inválidos", { issues: firstErrors(compiled.params, ctx.params) });
	}
	if (compiled.querystring && !compiled.querystring.Check(ctx.query)) {
		throw new HttpError(400, "INVALID_QUERY", "Query string inválida", { issues: firstErrors(compiled.querystring, ctx.query) });
	}
	// Body ausente = `{}` sin mutar `ctx.data` (los handlers hacen `ctx.data || {}` y alguno distingue el ausente):
	// TypeBox rechaza `undefined` contra un Type.Object, así que un schema todo-opcional daba un "Expected object"
	// engañoso; con propiedades requeridas sigue fallando, ya con "Expected required property". Type.Optional en la
	// raíz no arregla esto (Check lo ignora ahí) y un union con Type.Undefined emitiría JSON Schema inválido al OpenAPI.
	const bodyValue = ctx.data ?? {};
	if (compiled.body && !compiled.body.Check(bodyValue)) {
		throw new HttpError(400, "INVALID_BODY", "Cuerpo de la petición inválido", { issues: firstErrors(compiled.body, bodyValue) });
	}
}
