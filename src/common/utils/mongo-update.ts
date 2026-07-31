/**
 * Construcción segura de updates de MongoDB.
 *
 * Pasar un objeto de un request directo a `findOneAndUpdate` es inseguro incluso con
 * `strict: true`: mongoose reenvía los operadores que reconoce y mergea las claves planas dentro
 * del `$set`, saltándose la autorización por campo (ver `parts/schema.ts` → `assertNoOperatorKeys`,
 * que es la capa del borde HTTP). Ésta es la segunda capa, para los callers que no pasan por HTTP.
 *
 * Acá vive **sólo el mecanismo**: las allowlists viven en la capa `domain/` del servicio dueño de
 * cada colección (ver `docs/structure/services/models.md`).
 */

/** Campos que ningún update genérico puede tocar, en ninguna colección. */
const NEVER_UPDATABLE = new Set(["_id", "id", "createdAt", "passwordHash"]);

/**
 * Construye un `{ $set }` explícito con **sólo** los campos de `allowed` presentes en `updates`.
 *
 * - Descarta claves fuera de la allowlist, claves de operador (`$…`), rutas con punto y los campos
 *   de {@link NEVER_UPDATABLE}.
 * - Descarta `undefined` (mongoose intentaría escribirlo).
 * - `$set` explícito: al no haber claves planas en el update, mongoose no puede mergear nada dentro.
 *
 * @example
 * // `USER_UPDATABLE_FIELDS` lo declara el domain del servicio dueño de la colección.
 * import { USER_UPDATABLE_FIELDS } from "../domain/user.js";
 * const update = buildUpdateSet(updates, USER_UPDATABLE_FIELDS, { updatedAt: new Date() });
 * await this.userModel.findOneAndUpdate({ id }, update, { new: true });
 */
export function buildUpdateSet<T extends object>(
	updates: Partial<T> | undefined,
	allowed: readonly (keyof T & string)[],
	extra?: Record<string, unknown>
): { $set: Record<string, unknown> } {
	const set: Record<string, unknown> = {};
	if (updates) {
		const allowedSet = new Set<string>(allowed);
		for (const [key, value] of Object.entries(updates)) {
			if (value === undefined) continue;
			if (!allowedSet.has(key) || NEVER_UPDATABLE.has(key)) continue;
			if (key.startsWith("$") || key.includes(".")) continue;
			set[key] = value;
		}
	}
	for (const [key, value] of Object.entries(extra ?? {})) {
		if (value !== undefined) set[key] = value;
	}
	return { $set: set };
}
