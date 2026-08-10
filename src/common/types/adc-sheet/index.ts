/**
 * Contratos compartidos de la "hoja de cálculo ADC" (`.adcsheet`): una grilla
 * de bloques orientada a hojas de cálculo, editable con `adc-sheet-editor`
 * (media-ui-library) y guardada en Drive.
 *
 * El binario NO es un árbol JSON único: es JSON Lines (envelope en la primera
 * línea, una fila por línea). Así un archivo grande se parsea línea a línea y
 * las celdas comunes viven como strings planos — sin un objeto por celda.
 * Parse/serialize en `media-ui-library/utils/adcsheet.ts`.
 */

/** @public Mime de la hoja de cálculo ADC. */
export const ADC_SHEET_MIME = "application/x-adc-sheet";

/** @public Extensión sugerida para hojas de cálculo ADC. */
export const ADC_SHEET_EXT = "adcsheet";

/**
 * Celda extendida: bloque con propiedades abiertas. Hoy el editor solo usa
 * `v`; el resto (`f` fórmula, `bg` color, …) se conserva intacto al editar
 * aunque el editor todavía no lo entienda (forward-compatible).
 * @public
 */
export interface SheetCellBlock {
	/** Valor visible/editable de la celda. */
	v: string;
	/** Fórmula (reservada: hoy se conserva sin evaluar; se exporta a FODS). */
	f?: string;
	[prop: string]: unknown;
}

/** @public Celda: string plano (caso común, barato en memoria) o bloque extendido. */
export type SheetCell = string | SheetCellBlock;

/** @public Primera línea del archivo: identifica el formato y lleva sus metadatos. */
export interface AdcSheetEnvelope {
	format: "adc-sheet";
	version: number;
	title?: string;
	/** Propiedades futuras (anchos de columna, hoja activa, …) se conservan. */
	[prop: string]: unknown;
}

/** @public Hoja parseada: envelope + grilla (no necesariamente rectangular). */
export interface AdcSheet {
	envelope: AdcSheetEnvelope;
	/** Celdas por fila. Las filas planas quedan como arrays (sin wrapper). */
	rows: SheetCell[][];
	/**
	 * Propiedades extra por fila (índice paralelo a `rows`, casi siempre
	 * `undefined`): una fila con propiedades se serializa como bloque
	 * `{cells: […], …props}` en vez de array plano.
	 */
	rowProps: Array<Record<string, unknown> | undefined>;
}
