import { useEffect, useRef, useState } from "react";
import type { Comment } from "@common/types/comments/Comment.js";
import { socialApi } from "../utils/social-api";

/**
 * Mantiene un cache de URLs presignadas para todos los attachments
 * referenciados por una lista de comentarios (en `attachments[]` o en
 * bloques de tipo `attachment`).
 */
export function useCommentAttachmentUrls(slug: string, flat: Comment[]) {
	const [urls, setUrls] = useState<Record<string, string>>({});
	const requestedRef = useRef<Set<string>>(new Set());

	useEffect(() => {
		const ids = new Set<string>();
		for (const c of flat) {
			for (const att of c.attachments) ids.add(att.id);
			for (const b of c.blocks) {
				if (b.type === "attachment" && b.attachmentId) ids.add(b.attachmentId);
			}
		}
		const toFetch: string[] = [];
		for (const id of ids) {
			if (!urls[id] && !requestedRef.current.has(id)) {
				toFetch.push(id);
				requestedRef.current.add(id);
			}
		}
		if (toFetch.length === 0) return;
		(async () => {
			const updates: Record<string, string> = {};
			for (const id of toFetch) {
				const r = await socialApi.getAttachmentDownloadUrl(slug, id, { inline: true });
				if (r?.url) updates[id] = r.url;
			}
			if (Object.keys(updates).length > 0) setUrls((prev) => ({ ...prev, ...updates }));
		})();
	}, [flat, slug, urls]);

	const addUrl = (id: string, url: string) => setUrls((prev) => ({ ...prev, [id]: url }));
	return { urls, addUrl };
}
