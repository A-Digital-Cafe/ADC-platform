/**
 * Contrato público de las **métricas por endpoint** que expone `EndpointManagerService`.
 *
 * Vive en `@common` para que el panel de módulos (preset) consuma las métricas por
 * interfaz, sin importar la clase concreta de `@services`.
 */

/** Fila agregada de un endpoint. La clave es `"<METHOD> <url>"` (patrón de ruta, estable entre recargas). */
export interface EndpointMetricRow {
	/** `"<METHOD> <url>"`. Estable: no depende del `id` del endpoint, que se regenera en cada hot-reload. */
	key: string;
	method: string;
	url: string;
	/** Servicio dueño del endpoint. Vacío en días históricos (no se persiste). */
	owner: string;
	count: number;
	avgMs: number;
	/** Pico de latencia. `0` en días históricos: sólo existe en memoria. */
	maxMs: number;
	/**
	 * Promedio del cuerpo de las respuestas que **reportaron** tamaño (`content-length`).
	 * `null` = ninguna lo reportó (204/304, streams, respuestas hijackeadas): no medido ≠ 0 bytes.
	 */
	avgBytes: number | null;
	errCount: number;
	/** `errCount / count` (0..1). */
	errRate: number;
}

export interface IEndpointMetricsReader {
	/** Día `YYYY-MM-DD`; si se omite (o es hoy) devuelve el acumulado en memoria del proceso. */
	getEndpointMetrics(day?: string): Promise<{ day: string; endpoints: EndpointMetricRow[] }>;
	/** Limpia el acumulado en memoria de una clave (o de todas). Devuelve cuántas claves borró. */
	resetEndpointMetrics(key?: string): Promise<number>;
}
