/**
 * Rutas de los assets generados por namespace (cliente i18n y Service Worker).
 *
 * Vive en su propio módulo porque lo necesitan tanto el registrador de endpoints
 * (`server/i18n-sw-endpoints.ts`) como el generador del cliente
 * (`codegen/i18n-client.ts`), y ese último es importado por el primero: compartirlo desde
 * cualquiera de los dos crearía un ciclo.
 *
 * **Siempre** namespaceada: una ruta global la reclamarían los tres namespaces a la vez y sólo
 * serviría la del primero que registre.
 */
export function i18nAssetPath(namespace: string, filename: "adc-i18n.js" | "adc-sw.js"): string {
	return `/${namespace}/${filename}`;
}
