/**
 * Resolución de avatar en el cliente. Centraliza la lógica de fallback a
 * DiceBear y un caché batch para resolver avatares de autores cuando el
 * backend no los entregó (p. ej. comentarios antiguos o linkedAccounts
 * añadidos después de emitir el JWT).
 */

import { createAdcApi } from "./adc-fetch.js";
import { buildDicebearAvatar } from "@common/utils/avatar.js";

export { buildDicebearAvatar };

interface PublicProfile {
	username?: string;
	avatar?: string;
}

const api = createAdcApi({ basePath: "/api/identity", devPort: 3000, credentials: "include" });

const cache = new Map<string, PublicProfile>();
const inflight = new Map<string, Promise<PublicProfile>>();

/**
 * Devuelve la URL del avatar a renderizar, garantizando un fallback
 * determinista (DiceBear) cuando no hay foto disponible.
 */
export function buildAvatarUrl(opts: { avatar?: string | null; seed?: string | null }): string {
	if (opts.avatar) return opts.avatar;
	return buildDicebearAvatar(opts.seed || "default");
}

/**
 * Pide al backend (con caché + dedupe) los perfiles públicos (username + avatar)
 * de los `userIds` indicados. Hasta 50 ids por llamada (batch automático).
 */
export async function fetchPublicProfiles(userIds: readonly string[]): Promise<Map<string, PublicProfile>> {
	const out = new Map<string, PublicProfile>();
	const toFetch: string[] = [];
	const pending: Array<Promise<void>> = [];

	for (const id of userIds) {
		if (!id || out.has(id)) continue;
		const cached = cache.get(id);
		if (cached) {
			out.set(id, cached);
			continue;
		}
		const inflightPromise = inflight.get(id);
		if (inflightPromise) {
			pending.push(inflightPromise.then((p) => void out.set(id, p)));
		} else {
			toFetch.push(id);
		}
	}

	if (toFetch.length > 0) {
		const batches: string[][] = [];
		for (let i = 0; i < toFetch.length; i += 50) batches.push(toFetch.slice(i, i + 50));

		for (const batch of batches) {
			const batchPromise = (async () => {
				const res = await api.get<{ profiles: Record<string, PublicProfile> }>("/users/avatars", {
					params: { ids: batch.join(",") },
				});
				return res.success && res.data ? res.data.profiles : {};
			})();
			for (const id of batch) inflight.set(id, batchPromise.then((p) => p[id] ?? {}));
			pending.push(
				batchPromise.then((profiles) => {
					for (const id of batch) {
						const p = profiles[id] ?? {};
						cache.set(id, p);
						out.set(id, p);
						inflight.delete(id);
					}
				})
			);
		}
	}

	await Promise.all(pending);
	return out;
}

/** Atajo para un único usuario. */
export async function fetchPublicProfile(userId: string): Promise<PublicProfile> {
	const map = await fetchPublicProfiles([userId]);
	return map.get(userId) ?? {};
}

/** Limpia la caché (e.g. tras logout o cambios de avatar propios). */
export function clearAvatarCache(): void {
	cache.clear();
	inflight.clear();
}
