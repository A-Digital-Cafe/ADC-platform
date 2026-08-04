/**
 * Qué cuenta como "producción real" para la plataforma.
 *
 * `bun run start:prodtests` levanta con `NODE_ENV=production` para ejercitar los caminos de
 * prod, pero corre en la máquina del desarrollador: por eso `PROD_PORT=3000` actúa de
 * centinela y lo excluye. Vivía copiado en cinco archivos (cookies `Secure`, HSTS, CSP,
 * CSRF, headers de módulo UI); acá hay una sola definición para que no puedan divergir.
 *
 * Es una de las excepciones documentadas de `process.env`: NODE_ENV/PROD_PORT son del
 * proceso, no configuración de un módulo.
 */
export function isRealProduction(): boolean {
	return process.env.NODE_ENV === "production" && process.env.PROD_PORT !== "3000";
}
