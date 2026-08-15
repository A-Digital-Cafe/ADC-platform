/**
 * Configuración de plataforma que vive en la base y no en `env/`, porque es del CLÚSTER y no de la
 * máquina: cambiar la retención de un log no puede exigir editar un archivo en cada nodo y
 * reiniciarlos, con el riesgo de que uno quede distinto sin que nada avise.
 *
 * **No puede vivir acá** nada que se lea antes de que exista la base —credenciales de Mongo, Redis
 * y el broker, identidad del nodo, qué motores levanta, la clave maestra— ni los `ADC_PUBLIC_*`,
 * que se hornean en los bundles del navegador antes de que el kernel arranque.
 *
 * Este módulo **no lee la base**: recibe el mapa ya resuelto y lo entrega de forma síncrona, porque
 * quien lo consulta es `ModuleLoader.interpolateEnvVars` y volverlo asíncrono obligaría a reescribir
 * la carga de módulos entera. Lo instala `PlatformSettingsService` en su `start()` (`kernelMode 5`).
 */

/** Instalado una vez por `PlatformSettingsService`. `null` = todavía no se leyó la base. */
let snapshot: ReadonlyMap<string, string> | null = null;

/**
 * Instala el mapa resuelto. Lo llama **sólo** el servicio de configuración, y una vez por arranque:
 * un segundo reemplazo a mitad de la carga dejaría dos módulos configurados con valores distintos
 * sin que nada lo indique.
 */
export function installPlatformSettings(values: Record<string, string>): void {
	snapshot = new Map(Object.entries(values));
}

/** `undefined` si el nombre no es una opción de plataforma o si todavía no se leyó la base. */
export function platformSetting(name: string): string | undefined {
	return snapshot?.get(name);
}

/**
 * Refleja en memoria una opción que se acaba de guardar, para que el resto del proceso no relea la
 * base. La llama **sólo** `PlatformSettingsService`.
 *
 * No contradice el «una vez por arranque» de {@link installPlatformSettings}, que prohíbe reemplazar
 * el mapa entero: cambiar una clave desde el panel es una decisión explícita. Aplicar en caliente
 * queda de parte de cada consumidor, como hace el caudal de subida.
 */
export function updatePlatformSetting(name: string, value: string): void {
	if (!snapshot) return;
	const next = new Map(snapshot);
	next.set(name, value);
	snapshot = next;
}
