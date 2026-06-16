/**
 * Contratos compartidos del editor de imágenes (`adc-image-editor`) entre la
 * app UI y `ImageEditorService`. Solo tipos/constantes serializables; la lógica
 * de límites vive en `../tiers/image-editor.ts`.
 */

import type { AccountTier } from "../tiers.ts";
import type { ExportFormat, ImageEditorLimits, ImageEditorMetric } from "../tiers/image-editor.ts";

export type { ExportFormat, ImageEditorMetric } from "../tiers/image-editor.ts";

/**
 * Mime del archivo de proyecto del editor, guardado en el Drive del usuario.
 * El binario es un bundle ZIP `{ scene.json, assets/* }` (ver `projectFile.ts`).
 */
export const IMAGE_PROJECT_MIME = "application/x-adc-image-project";

/** Extensión sugerida para archivos de proyecto. */
export const IMAGE_PROJECT_EXT = "adcedit";

/** Mime de una plantilla del editor (escena reutilizable como punto de partida). */
export const IMAGE_TEMPLATE_MIME = "application/x-adc-image-template";

/** Extensión sugerida para archivos de plantilla. */
export const IMAGE_TEMPLATE_EXT = "adctmpl";

/** Ventana de medición de una métrica de uso. */
export type UsageWindow = "day" | "month";

/** Consumo actual del usuario por métrica (claves = `ImageEditorMetric`). */
export type UsageSnapshot = Record<ImageEditorMetric, { day: number; month: number }>;

/** Respuesta de `GET /api/image-editor/me/limits`: tier + límites + consumo. */
export interface EntitlementsDTO {
	tier: AccountTier;
	limits: ImageEditorLimits;
	usage: UsageSnapshot;
}

/** Estado de un job de inferencia (espejo del poll genérico `/api/jobs/:id`). */
export type InferenceJobStatus = "queued" | "running" | "completed" | "failed";

/** Resultado de encolar/consultar un job de eliminación de fondo o sticker. */
export interface InferenceJobDTO {
	jobId: string;
	status: InferenceJobStatus;
	/** URL (presignada o relativa al backend) del PNG resultante cuando `completed`. */
	resultUrl?: string;
	/** errorKey i18n cuando `failed`. */
	error?: string;
}

/** Parámetros de una solicitud de export validada server-side. */
export interface ExportRequest {
	format: ExportFormat;
	/** Lado más largo en px de la imagen exportada. */
	longEdge: number;
}
