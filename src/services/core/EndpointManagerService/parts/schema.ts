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
 * @example
 * import { Type } from "@sinclair/typebox";
 *
 * @RegisterEndpoint({
 *   method: "POST",
 *   url: "/api/auth/register",
 *   permissions: [],
 *   options: {
 *     schema: {
 *       body: Type.Object({
 *         username: Type.String({ minLength: 3, maxLength: 32 }),
 *         email: Type.String({ format: "email" }),
 *       }),
 *     },
 *   },
 * })
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
	if (compiled.body && !compiled.body.Check(ctx.data)) {
		throw new HttpError(400, "INVALID_BODY", "Cuerpo de la petición inválido", { issues: firstErrors(compiled.body, ctx.data) });
	}
}
