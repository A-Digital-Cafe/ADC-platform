/**
 * Parseo + validación de JSON contra schemas TypeBox compilados.
 *
 * Reutiliza la misma stack que la validación de endpoints HTTP
 * (`@sinclair/typebox/compiler`, ver `EndpointManagerService/parts/schema.ts`):
 * una única fuente para el tipo TS y el validador runtime, sin dependencias
 * nuevas. Pensado para fronteras donde `JSON.parse` recibe datos NO garantizados
 * (cache/Redis, IPC, archivos de configuración): en lugar de un `as T` ciego —que
 * no comprueba nada en runtime— se valida el shape y se decide entre *fail-closed*
 * (descartar el valor) o *fail-fast* (abortar con contexto).
 */
import { TypeCompiler, type TypeCheck } from "@sinclair/typebox/compiler";
import type { Static, TSchema } from "@sinclair/typebox";

/** Compila un schema TypeBox una sola vez (alias semántico de `TypeCompiler.Compile`). */
export function compileSchema<T extends TSchema>(schema: T): TypeCheck<T> {
	return TypeCompiler.Compile(schema);
}

/**
 * Parsea `raw` como JSON y lo valida contra `check`. Devuelve el valor tipado, o
 * `null` si el string es vacío/nulo, no es JSON válido, o no cumple el schema.
 *
 * **Fail-closed**: pensado para datos semi-confiables (Redis/cache/IPC) donde un
 * valor corrupto o manipulado debe tratarse como ausente en lugar de propagarse a
 * una decisión de seguridad (tokens, bloqueos, permisos, ...).
 */
export function safeParseJson<T extends TSchema>(raw: string | null | undefined, check: TypeCheck<T>): Static<T> | null {
	if (!raw) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	return check.Check(parsed) ? (parsed as Static<T>) : null;
}

/**
 * Parsea `raw` como JSON y lo valida contra `check`; **lanza** con un mensaje
 * contextual si el JSON es inválido o no cumple el schema.
 *
 * **Fail-fast**: para configuración de confianza (archivos locales) donde un
 * fallo debe detener el arranque de forma explícita en lugar de degradar en
 * silencio. `context` se usa para identificar la fuente en el mensaje de error.
 */
export function parseJsonOrThrow<T extends TSchema>(raw: string, check: TypeCheck<T>, context: string): Static<T> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		throw new Error(`[${context}] JSON inválido: ${(err as Error).message}`, { cause: err });
	}
	if (!check.Check(parsed)) {
		const first = check.Errors(parsed).First();
		const detail = first ? `${first.path || "/"} ${first.message}` : "shape inesperado";
		throw new Error(`[${context}] No cumple el schema esperado: ${detail}`);
	}
	return parsed as Static<T>;
}
