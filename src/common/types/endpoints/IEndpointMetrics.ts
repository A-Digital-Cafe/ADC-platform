/**
 * Contrato público de las **métricas por endpoint** que expone `EndpointManagerService`.
 *
 * Vive en `@common` para que el panel de módulos (preset) consuma las métricas por
 * interfaz, sin importar la clase concreta de `@services`.
 *
 * La ventana es **móvil**: las últimas 24 horas cerradas más el tramo de la hora en curso.
 * No hay noción de "día": las horas cerradas se archivan una por una y la más vieja se cae
 * sola, así que a las 00:05 se sigue viendo la tarde anterior en vez de una tabla vacía.
 */

/** Fila agregada de un endpoint. La clave es `"<METHOD> <url>"` (patrón de ruta, estable entre recargas). */
export interface EndpointMetricRow {
	/** `"<METHOD> <url>"`. Estable: no depende del `id` del endpoint, que se regenera en cada hot-reload. */
	key: string;
	method: string;
	url: string;
	/** Servicio dueño del endpoint. Puede venir vacío si sólo hay tramos archivados sin dueño registrado. */
	owner: string;
	/** Llamadas de TODA la ventana: las 24 h cerradas más lo que va de la hora en curso. */
	count: number;
	/**
	 * Llamadas/hora promediadas **sólo sobre las horas cerradas** (`hours` de la página). La hora
	 * en curso queda afuera a propósito: un tramo de 3 minutos deprime la media tanto como para
	 * volverla inútil. `null` = todavía no cerró ninguna hora medida.
	 */
	perHour: number | null;
	/** Llamadas del tramo de la hora en curso. Se cuentan en `count`, no en `perHour`. */
	currentCount: number;
	/** Llamadas por hora cerrada, alineado 1:1 con `hours` de la página (mismo largo y orden). */
	hourly: number[];
	avgMs: number;
	/**
	 * Percentil 90 de latencia, estimado sobre un histograma de clases logarítmicas (el error
	 * queda acotado por el ancho de la clase). `null` = ninguna muestra de la ventana lo registró.
	 */
	p90Ms: number | null;
	/** Pico de latencia de la ventana. */
	maxMs: number;
	/**
	 * Promedio del cuerpo de las respuestas que **reportaron** tamaño (`content-length`).
	 * `null` = ninguna lo reportó (204/304, streams, respuestas hijackeadas): no medido ≠ 0 bytes.
	 */
	avgBytes: number | null;
	errCount: number;
	/** `errCount / count` (0..1). */
	errRate: number;
	/** Desglose de `errCount` por código HTTP (`{ "404": 12, "500": 3 }`). Sólo códigos >= 400. */
	errByStatus: Record<string, number>;
}

/** Ventana móvil de métricas: 24 horas cerradas + el tramo de la hora en curso. */
export interface EndpointMetricsPage {
	/** ISO. Instante de la lectura: el final de la ventana. */
	generatedAt: string;
	/** ISO. Comienzo de la hora en curso; lo posterior es el tramo parcial (aún sin archivar). */
	currentHourStart: string;
	/**
	 * ISO, ascendente. Horas cerradas **efectivamente medidas** dentro de la ventana: una hora en
	 * la que el kernel estuvo caído no aparece, y por eso no diluye la media de `perHour`.
	 */
	hours: string[];
	endpoints: EndpointMetricRow[];
}

export interface IEndpointMetricsReader {
	/** Ventana móvil de 24 h: horas archivadas + el tramo en curso (Redis + delta en memoria). */
	getEndpointMetrics(): Promise<EndpointMetricsPage>;
	/** Borra una clave (o todas) de la ventana entera: histórico archivado, hora en curso y memoria. */
	resetEndpointMetrics(key?: string): Promise<number>;
}
