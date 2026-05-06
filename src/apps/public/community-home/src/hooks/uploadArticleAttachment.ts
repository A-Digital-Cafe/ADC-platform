import type { Block } from "@common/ADC/types/learning.js";
import { socialApi } from "../utils/social-api";
import type { RequestAttachmentDetail } from "./useArticleComments";

/**
 * Crea un handler que abre un selector de archivo, presigna y sube un attachment
 * al artículo, y propaga el resultado hacia el draft + cache de URLs.
 */
export function makeRequestAttachmentHandler(
	slug: string,
	addUrl: (id: string, url: string) => void,
	pushBlock: (b: Block) => void,
	pushAttachmentId: (id: string) => void
) {
	return (detail: RequestAttachmentDetail) => {
		if (detail.parentId !== null || detail.editingCommentId !== null) return;
		const input = globalThis.document.createElement("input");
		input.type = "file";
		if (detail.kind === "image") input.accept = "image/*";
		input.onchange = async () => {
			const file = input.files?.[0];
			if (!file) return;
			const presign = await socialApi.presignAttachment(slug, {
				fileName: file.name,
				mimeType: file.type || "application/octet-stream",
				size: file.size,
				forComment: true,
			});
			if (!presign) return;
			const putRes = await fetch(presign.uploadUrl, { method: "PUT", body: file, headers: presign.headers });
			if (!putRes.ok) return;
			const att = await socialApi.confirmAttachment(slug, presign.attachmentId);
			if (!att) return;
			const dl = await socialApi.getAttachmentDownloadUrl(slug, att.id, { inline: true });
			if (dl?.url) addUrl(att.id, dl.url);
			pushBlock({
				type: "attachment",
				kind: detail.kind,
				attachmentId: att.id,
				fileName: att.fileName,
				mimeType: att.mimeType,
				size: att.size,
			});
			pushAttachmentId(att.id);
		};
		input.click();
	};
}
