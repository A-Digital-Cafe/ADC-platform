/**
 * Utilidades de strings compartidas (única fuente de verdad).
 *
 * No reimplementar estos helpers en services/presets: importarlos desde
 * `@common/utils/strings.ts`.
 */

/**
 * Recorta todas las apariciones de `char` en ambos extremos de `value`.
 * Reemplazo lineal y sin regex de `value.replace(/^X+|X+$/g, "")`, cuyo
 * `X+$` tiene backtracking super-lineal (typescript:S8786).
 */
export function trimChar(value: string, char: string): string {
	let start = 0;
	let end = value.length;
	while (start < end && value[start] === char) start++;
	while (end > start && value[end - 1] === char) end--;
	return start === 0 && end === value.length ? value : value.slice(start, end);
}
