/**
 * Contratos compartidos del "documento ADC" (`.adcdoc`): un documento de Blocks
 * extendido (saltos de página, tablas extendidas, bloques con margen) editable con
 * `adc-document-editor` (media-ui-library) y guardado en Drive como JSON UTF-8.
 * Solo tipos/constantes serializables.
 */

import type { Block, TextAlign } from "../../ADC/types/learning.ts";

/** @public Mime del documento ADC. El binario es el JSON UTF-8 de `AdcDocument`. */
export const ADC_DOCUMENT_MIME = "application/x-adc-document";

/** @public Extensión sugerida para documentos ADC. */
export const ADC_DOCUMENT_EXT = "adcdoc";

/** Fusión de celdas de una tabla extendida (coordenadas 0-based sobre `rows`). */
interface TableMerge {
	row: number;
	col: number;
	rowSpan: number;
	colSpan: number;
}

/**
 * Bloques del documento ADC: superset por unión del `Block` canónico.
 * `page-break` fuerza salto de página (visual en pantalla, real al imprimir).
 * `table-x` extiende `table` con anchos de columna, fusiones y cabeceras de fila.
 * `margin-box` agrupa otros bloques con un margen lateral propio (sangría).
 * @public
 */
export type DocumentBlock =
	| Block
	| { type: "page-break" }
	| {
			type: "table-x";
			header: string[];
			rows: string[][];
			columnAlign?: TextAlign[];
			/** Ancho relativo por columna (fracción 0-1) o null (auto). */
			colWidths?: (number | null)[];
			merges?: TableMerge[];
			caption?: string;
			rowHeaders?: boolean;
	  }
	| {
			type: "margin-box";
			/** Margen lateral en cm (se suma al margen de la página). */
			margin: number;
			blocks: DocumentBlock[];
	  };

/** @public Tamaños de hoja soportados (pantalla e impresión). */
export type PageSizeId = "a4" | "letter" | "legal";

/** Márgenes de página en cm. */
interface PageMargins {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

/** @public Configuración de página del documento (paginación en pantalla e impresión). */
export interface PageSetup {
	size: PageSizeId;
	margins: PageMargins;
}

/** @public Envelope serializado de un `.adcdoc`. */
export interface AdcDocument {
	format: "adc-document";
	version: 1;
	title?: string;
	meta?: {
		author?: string;
		createdAt?: string;
		updatedAt?: string;
	};
	/** Configuración de página; si falta, el editor usa A4 con márgenes de 2cm. */
	page?: PageSetup;
	blocks: DocumentBlock[];
}
