/**
 * Contratos compartidos de los generadores (`adc-generators`) entre la app UI y
 * `GeneratorsService`.
 *
 * Mismo criterio que el editor de imágenes: acá viven los tipos, las constantes
 * serializables y el **piso `free`** —que es la experiencia anónima y el fallback
 * sin motor de planes, o sea público por definición—. Los límites de los tiers
 * pagos NO viven en el código: la UI los pide por `GET /api/generators/me/limits`
 * y el servicio los resuelve contra `PlanService`.
 *
 * Lo que estos límites gatean es **el output**, nunca la generación: convertir
 * texto, armar una paleta o medir contraste no pasa por el servidor ni consume
 * cuota. Gatear el catálogo de estilos sería inaplicable (vive en el cliente) y
 * dejaría la versión gratuita sin valor.
 */

import type { AccountTier } from "../tiers.ts";

/** @public Re-export del centinela de "sin tope" y sus helpers (ver `plans/catalog.ts`). */
export { UNLIMITED, isUnlimited, remaining } from "../plans/catalog.ts";

/**
 * @public Formatos de exportación de los generadores que producen una imagen.
 *
 * Todos salen de `canvas.toBlob`. El vectorial (SVG con los glifos convertidos a
 * curvas) queda para una fase posterior: hay que parsear el archivo de fuente con
 * `opentype.js` —los paquetes de `@fontsource` publican `.woff` además de `.woff2`,
 * así que el camino existe— y eso es una dependencia y una prueba más, no un
 * `toBlob`. Se suma cuando esté verificado, no antes.
 */
export type ExportFormat = "png" | "jpg" | "webp";

/** @public Amplitud del catálogo de tipografías disponible según el tier. */
export type FontLibraryTier = "basic" | "full";

/** @public Métricas medidas por ventana (día/mes) y enforce-adas server-side. */
export type GeneratorsMetric = "export";

/** @public Límites concretos aplicables a un usuario según su tier. */
export interface GeneratorsLimits {
	/** Exportaciones por mes (`UNLIMITED` = sin tope). */
	exportsPerMonth: number;
	/** Exportaciones por día (`UNLIMITED` = sin tope). */
	exportsPerDay: number;
	/** Lado más largo máximo de la imagen exportada, en px. */
	maxExportLongEdge: number;
	/** Amplitud del catálogo de tipografías. */
	fonts: FontLibraryTier;
	/** Fondo transparente en el PNG. */
	transparency: boolean;
	/** Exportar una paleta como variables CSS / tema de Tailwind / JSON. */
	tokenExport: boolean;
	/** Generar en lote (varias líneas o varias variantes de una vez). */
	batch: boolean;
	/** Guardar kits de marca (paleta + tipografías) como archivo en el Drive. */
	brandKits: boolean;
}

/**
 * Piso del plan gratuito: la experiencia anónima y el fallback si el motor de
 * planes no responde.
 *
 * Es deliberadamente generoso en lo que no cuesta nada (la conversión de texto y
 * las paletas ni aparecen acá porque no se gatean) y acotado en lo que produce un
 * archivo.
 * @public
 */
export const GENERATORS_FREE_LIMITS: GeneratorsLimits = {
	exportsPerMonth: 30,
	exportsPerDay: 5,
	maxExportLongEdge: 1080,
	fonts: "basic",
	transparency: false,
	tokenExport: false,
	batch: false,
	brandKits: false,
};

/** @public Parámetros de una solicitud de export validada server-side. */
export interface ExportRequest {
	format: ExportFormat;
	/** Lado más largo en px de la imagen exportada. */
	longEdge: number;
	/** Pide fondo transparente (sólo PNG). */
	transparent?: boolean;
}

/** @public `true` si el export pedido entra en los límites dados. */
export function canExportAt(limits: GeneratorsLimits, req: ExportRequest): boolean {
	// JPG no tiene canal alfa: pedir transparencia ahí es un error de la UI, no del plan.
	if (req.transparent && (req.format === "jpg" || !limits.transparency)) return false;
	return req.longEdge > 0 && req.longEdge <= limits.maxExportLongEdge;
}

/** @public Consumo actual del usuario por métrica. */
export type UsageSnapshot = Record<GeneratorsMetric, { day: number; month: number }>;

/** @public Respuesta de `GET /api/generators/me/limits`: tier + límites + consumo. */
export interface EntitlementsDTO {
	tier: AccountTier;
	limits: GeneratorsLimits;
	usage: UsageSnapshot;
}

/**
 * Mime del kit de marca guardado en el Drive del usuario: paleta, tipografías
 * elegidas y preferencias de export. Es JSON plano.
 *
 * Vive en el Drive y no en una colección propia a propósito: reusa el flujo de
 * presign, la cuota del plan de Drive alcanza como límite y no crea un
 * tratamiento de datos nuevo que haya que declarar.
 * @public
 */
export const BRAND_KIT_MIME = "application/x-adc-brand-kit";

/** @public Extensión sugerida para un kit de marca. */
export const BRAND_KIT_EXT = "adckit";

/** @public Un color de una paleta generada. */
export interface PaletteColor {
	/** Hex `#rrggbb`. */
	hex: string;
	/** Nombre generado localmente (nunca de un sistema con marca: ver README). */
	name?: string;
	/** Si está fijado, no cambia al regenerar la paleta. */
	locked?: boolean;
}

/** @public Contenido de un archivo de kit de marca. */
export interface BrandKit {
	version: 1;
	name: string;
	palette: PaletteColor[];
	/** Ids de tipografías del registry de la app. */
	fonts: string[];
}
