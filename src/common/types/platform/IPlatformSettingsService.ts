/**
 * Escritura de la configuración de plataforma desde otros módulos.
 *
 * La LECTURA no pasa por acá: es `platformSetting()` de `@common/utils/platform-settings.ts`, que es
 * síncrona porque la consume la interpolación de los `config.json`. Esta interfaz existe sólo para
 * el camino de escritura, que sí necesita la base — y para que un panel no tenga que meterle mano a
 * la colección de otro servicio.
 */

export interface PlatformSettingEntry {
	name: string;
	value: string;
	/** Agrupación para la pantalla (`limites`, `retenciones`, `urls`, …). */
	group: string;
	help: string;
	updatedAt: string | null;
	updatedBy: string | null;
}

export interface IPlatformSettingsService {
	listSettings(): Promise<PlatformSettingEntry[]>;
	/**
	 * Cambia una opción. Rechaza los nombres que no estén declarados en los defaults: sin esa lista
	 * blanca, un panel comprometido podría sembrar cualquier clave y quedaría interpolándose dentro de
	 * los `config.json` de todos los módulos.
	 *
	 * Actualiza además la copia en memoria de ESTE proceso, así que quien lea `platformSetting()`
	 * después ve el valor nuevo. Los otros nodos lo toman al arrancar: lo que necesite aplicarse en
	 * caliente en todo el clúster tiene que propagarlo quien lo cambia.
	 */
	setSetting(name: string, value: string, actor: string | undefined): Promise<void>;
}
