import type { Block } from "../../ADC/types/learning.js";

/**
 * Extrae los IDs de usuarios mencionados (`@usuario`) a lo largo de un `Block[]`
 * (comentario o descripción), deduplicados. Lo usan los productores de
 * notificaciones para avisar a los mencionados (topic `*.mention`).
 */
export function extractMentions(blocks: Block[] | undefined | null): string[] {
	if (!blocks?.length) return [];
	const ids = new Set<string>();
	for (const block of blocks) {
		const mentions = (block as { mentions?: unknown }).mentions;
		if (Array.isArray(mentions)) {
			for (const id of mentions) if (typeof id === "string" && id) ids.add(id);
		}
	}
	return [...ids];
}
