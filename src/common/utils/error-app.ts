/**
 * Coordenadas de `adc-error`, la app que muestra las páginas de error de la plataforma.
 *
 * Isomórfico a propósito (sin `globalThis.location` ni `process.env`): lo usan tanto el
 * cliente (`module-availability.ts`) como el gate de acceso del kernel, que resuelve la URL
 * desde el host de la request y no desde el suyo.
 */

/** Puerto del dev server de adc-error (ver docs/guides/ports.csv). */
export const ERROR_APP_DEVPORT = 3026;
/** Host de producción de adc-error. */
export const ERROR_APP_PROD_HOST = "error.adigitalcafe.com";

export type ErrorAppPage = "/" | "/banned" | "/csrf" | "/oauth" | "/maintenance" | "/unauthorized";

/** `"/unauthorized?app=x&reason=perm"` — sin origen, para que cada llamador le ponga el suyo. */
export function errorAppPath(page: ErrorAppPage, params: Record<string, string | undefined | null> = {}): string {
	const qs = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value != null && value !== "") qs.set(key, value);
	}
	const search = qs.toString();
	return search ? `${page}?${search}` : page;
}
