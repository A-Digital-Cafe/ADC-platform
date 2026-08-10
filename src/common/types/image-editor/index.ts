/**
 * Contratos compartidos del editor de imágenes (`adc-image-editor`) entre la
 * app UI y `ImageEditorService`.
 *
 * Contiene tipos, constantes serializables y el **piso `free`**: es lo que ve un
 * usuario anónimo y el fallback sin motor de planes, así que es público por
 * definición. Los límites de los tiers pagos NO viven en el código (ni llegan al
 * bundle del front): la UI los recibe por `GET /api/image-editor/me/limits` y el
 * servicio los resuelve contra `PlanService`.
 */

import type { AccountTier } from "../tiers.ts";
import { UNLIMITED } from "../plans/catalog.ts";

/**
 * Sentinela JSON-safe para un límite sin tope y sus helpers. Viven en
 * `@common/types/plans/catalog.ts` (son transversales a todas las features, no
 * propios del editor); se re-exportan acá para no romper a los consumidores.
 * @public
 */
export { UNLIMITED, isUnlimited, remaining } from "../plans/catalog.ts";

/** @public Familias de presets de blur disponibles según el tier. */
export type BlurTier = "basic" | "full" | "advanced";

/** @public Amplitud de la biblioteca de assets/stickers según el tier. */
export type AssetLibraryTier = "basic" | "full";

/** @public Formatos de exportación soportados por el editor. */
export type ExportFormat = "jpg" | "png" | "webp";

/** @public Métricas de uso medidas por ventana (día/mes) y enforce-adas server-side. */
export type ImageEditorMetric = "export" | "bgRemoval" | "stickerGen";

/** @public Límites concretos aplicables a un usuario según su tier. */
export interface ImageEditorLimits {
	/** Exportaciones por mes (`UNLIMITED` = sin tope). */
	exportsPerMonth: number;
	/** Exportaciones por día (`UNLIMITED` = sin tope). */
	exportsPerDay: number;
	/** Lado más largo máximo del export en px (720p=1280, 1080p=1920, 8K=7680). */
	maxExportLongEdge: number;
	/** Formatos permitidos (JPG no preserva transparencia). */
	allowedFormats: readonly ExportFormat[];
	/** Eliminaciones de fondo por mes (`UNLIMITED` = sin tope). */
	bgRemovalPerMonth: number;
	/** Eliminaciones de fondo por día (`UNLIMITED` = sin tope). */
	bgRemovalPerDay: number;
	/** Generaciones automáticas de sticker por mes. */
	stickerGenPerMonth: number;
	/** Capas máximas por proyecto (`UNLIMITED` = sin tope). */
	maxLayers: number;
	/** Profundidad del historial de undo/redo. */
	undoDepth: number;
	/** Familia de presets de blur/backdrop disponible. */
	blur: BlurTier;
	/** Amplitud de la biblioteca de assets. */
	assets: AssetLibraryTier;
}

/**
 * Piso del plan gratuito: la experiencia anónima del editor y el fallback si el
 * motor de planes no responde.
 * @public
 */
export const IMAGE_EDITOR_FREE_LIMITS: ImageEditorLimits = {
	exportsPerMonth: 30,
	exportsPerDay: 1,
	maxExportLongEdge: 1280, // 720p
	allowedFormats: ["jpg"], // sin transparencia en el plan gratuito
	bgRemovalPerMonth: 10,
	bgRemovalPerDay: UNLIMITED,
	stickerGenPerMonth: 10,
	maxLayers: 5,
	undoDepth: 2,
	blur: "basic",
	assets: "basic",
};

/** @public `true` si exportar al `longEdge`/`format` pedidos está permitido por los límites dados. */
export function canExportAt(limits: ImageEditorLimits, longEdge: number, format: ExportFormat): boolean {
	return longEdge <= limits.maxExportLongEdge && limits.allowedFormats.includes(format);
}

/**
 * Mime del archivo de proyecto del editor, guardado en el Drive del usuario.
 * El binario es un bundle ZIP `{ scene.json, assets/* }` (ver `projectFile.ts`).
 * @public
 */
export const IMAGE_PROJECT_MIME = "application/x-adc-image-project";

/** @public Extensión sugerida para archivos de proyecto. */
export const IMAGE_PROJECT_EXT = "adcedit";

/** @public Mime de una plantilla del editor (escena reutilizable como punto de partida). */
export const IMAGE_TEMPLATE_MIME = "application/x-adc-image-template";

/** @public Extensión sugerida para archivos de plantilla. */
export const IMAGE_TEMPLATE_EXT = "adctmpl";

/** @public Ventana de medición de una métrica de uso. */
export type UsageWindow = "day" | "month";

/** @public Consumo actual del usuario por métrica (claves = `ImageEditorMetric`). */
export type UsageSnapshot = Record<ImageEditorMetric, { day: number; month: number }>;

/** @public Respuesta de `GET /api/image-editor/me/limits`: tier + límites + consumo. */
export interface EntitlementsDTO {
	tier: AccountTier;
	limits: ImageEditorLimits;
	usage: UsageSnapshot;
}

/** Estado de un job de inferencia (espejo del poll genérico `/api/jobs/:id`). */
type InferenceJobStatus = "queued" | "running" | "completed" | "failed";

/** @public Resultado de encolar/consultar un job de eliminación de fondo o sticker. */
export interface InferenceJobDTO {
	jobId: string;
	status: InferenceJobStatus;
	/** URL (presignada o relativa al backend) del PNG resultante cuando `completed`. */
	resultUrl?: string;
	/** errorKey i18n cuando `failed`. */
	error?: string;
}

/** @public Parámetros de una solicitud de export validada server-side. */
export interface ExportRequest {
	format: ExportFormat;
	/** Lado más largo en px de la imagen exportada. */
	longEdge: number;
}
