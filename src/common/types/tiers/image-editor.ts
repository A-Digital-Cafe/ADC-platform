/**
 * Límites del editor de imágenes (`adc-image-editor`) por tier de cuenta.
 *
 * Fuente única de verdad compartida entre la app UI y `ImageEditorService`:
 * la UI la usa para feedback inmediato (deshabilitar acciones, prompts de
 * upgrade) y el servicio la usa como autoridad real al medir uso y exportar.
 *
 * Resolución del tier: `user.metadata.accountTier` (default `free`), igual que
 * el resto de la plataforma (ver [[adc-platform-quirks]] y `../tiers.ts`).
 *
 * Convención de "ilimitado": `UNLIMITED` (`-1`) en cualquier número de límite,
 * para que el contrato sea serializable a JSON (a diferencia de `Infinity`).
 */

import type { AccountTier } from "../tiers.ts";

/** Sentinela JSON-safe para un límite sin tope. */
export const UNLIMITED = -1;

/** Familias de presets de blur disponibles según el tier. */
export type BlurTier = "basic" | "full" | "advanced";

/** Amplitud de la biblioteca de assets/stickers según el tier. */
export type AssetLibraryTier = "basic" | "full";

/** Formatos de exportación soportados por el editor. */
export type ExportFormat = "jpg" | "png" | "webp";

/** Métricas de uso medidas por ventana (día/mes) y enforce-adas server-side. */
export type ImageEditorMetric = "export" | "bgRemoval" | "stickerGen";

/** Límites concretos aplicables a un usuario según su tier. */
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

const ALL_FORMATS: readonly ExportFormat[] = ["jpg", "png", "webp"];

const LIMITS: Record<AccountTier, ImageEditorLimits> = {
	free: {
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
	},
	pro: {
		exportsPerMonth: UNLIMITED,
		exportsPerDay: UNLIMITED,
		maxExportLongEdge: 1920, // 1080p
		allowedFormats: ALL_FORMATS,
		bgRemovalPerMonth: 60,
		bgRemovalPerDay: 2,
		stickerGenPerMonth: 20,
		maxLayers: 10,
		undoDepth: 5,
		blur: "full",
		assets: "full",
	},
	plus: {
		exportsPerMonth: UNLIMITED,
		exportsPerDay: UNLIMITED,
		maxExportLongEdge: 7680, // 8K
		allowedFormats: ALL_FORMATS,
		bgRemovalPerMonth: UNLIMITED,
		bgRemovalPerDay: UNLIMITED,
		stickerGenPerMonth: UNLIMITED,
		maxLayers: UNLIMITED,
		undoDepth: 10,
		blur: "advanced",
		assets: "full",
	},
};

/** Límites del tier de cuenta (default `free` ante un tier desconocido). */
export function getImageEditorLimits(tier: AccountTier = "free"): ImageEditorLimits {
	return LIMITS[tier] ?? LIMITS.free;
}

/** `true` si el límite no tiene tope. */
export function isUnlimited(limit: number): boolean {
	return limit === UNLIMITED;
}

/** Unidades restantes para un límite dado un consumo (`Infinity` si es ilimitado). */
export function remaining(limit: number, used: number): number {
	return isUnlimited(limit) ? Number.POSITIVE_INFINITY : Math.max(0, limit - used);
}

/** `true` si exportar al `longEdge`/`format` pedidos está permitido por el tier. */
export function canExportAt(limits: ImageEditorLimits, longEdge: number, format: ExportFormat): boolean {
	return longEdge <= limits.maxExportLongEdge && limits.allowedFormats.includes(format);
}
