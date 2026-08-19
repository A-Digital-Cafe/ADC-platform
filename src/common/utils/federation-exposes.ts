/**
 * Nombre del chunk que rspack emite para un `expose` de Module Federation.
 *
 * Vive en `@common` porque lo necesitan los dos extremos y tienen que coincidir exactamente: el
 * generador de la config del bundler (que lo pasa como `name` del expose) y el servidor (que
 * protege ese archivo por prefijo de ruta). Dos copias que se separen dejarían el chunk sin gate
 * y sin ningún error visible.
 */

/** `"./ModerationPanel"` → `"expose_ModerationPanel"`. */
export function exposeChunkName(exposeKey: string): string {
	const slug = exposeKey.replace(/^\.\//, "").replaceAll(/[^A-Za-z0-9_-]/g, "_");
	return `expose_${slug}`;
}

/**
 * Prefijo de URL del chunk de un expose, tal como queda en el host del remote. El archivo real
 * lleva el `[contenthash]` detrás (`/expose_ModerationPanel.a1b2c3d4.js`), así que se compara por
 * prefijo y no por nombre exacto.
 */
export function exposeChunkPathPrefix(exposeKey: string): string {
	return `/${exposeChunkName(exposeKey)}.`;
}
