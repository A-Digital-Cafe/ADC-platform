/**
 * Evaluación del `uiModule.access` de un `config.json`: qué roles pueden recibir el contenido
 * de un módulo UI.
 *
 * Se compara por **nombre de rol**, normalizado (trim + minúsculas) para que un
 * `"app manager"` en un config.json valga tanto como `"App Manager"`. Los nombres salen de
 * `SystemRole` (`@common/types/identity/systemRoles.ts`) para los roles del sistema, pero un
 * rol propio se declara igual: por su nombre.
 */

/** Clave de comparación de un nombre de rol. */
export function roleKey(name: string): string {
	return name.trim().toLowerCase();
}

/** Normaliza la lista declarada en el config, descartando entradas vacías. */
export function normalizeAccessRoles(roles: readonly string[]): string[] {
	return [...new Set(roles.map(roleKey).filter(Boolean))];
}

/**
 * ¿Alguno de los roles del usuario está entre los requeridos? Semántica **any-of**: la lista
 * describe "quiénes entran", y un panel suele admitir más de un rol con vistas distintas (el
 * gestor de módulos lo abren App Manager y, sólo para la auditoría, Security Manager).
 *
 * `required` vacío = no se pide ningún rol concreto (basta la sesión).
 */
export function accessAllowsRoles(userRoles: readonly string[], required: readonly string[]): boolean {
	if (required.length === 0) return true;
	const wanted = new Set(required);
	return userRoles.some((role) => wanted.has(roleKey(role)));
}
