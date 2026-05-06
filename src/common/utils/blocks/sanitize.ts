import type { Block, TextMark, TextAlign, CalloutTone, CalloutRole, LinkRel } from "../../ADC/types/learning.js";

/**
 * Sanitizador de Block[] reutilizable en backend (utility de comments) y frontend (editor).
 * Filtra campos desconocidos, recorta strings, valida unión discriminada y restringe a tipos permitidos.
 */

const TEXT_MAX = 4000;
const HEADING_MAX = 240;
const LIST_ITEM_MAX = 600;
const CODE_MAX = 8000;
const TABLE_CELL_MAX = 400;
const MAX_LIST_ITEMS = 100;
const MAX_TABLE_ROWS = 200;
const MAX_TABLE_COLS = 20;

const TEXT_ALIGNS: readonly TextAlign[] = ["left", "center", "right"];
const TEXT_MARKS: readonly TextMark[] = ["bold", "italic", "code"];
const CALLOUT_TONES: readonly CalloutTone[] = ["info", "warning", "success", "error"];
const CALLOUT_ROLES: readonly CalloutRole[] = ["note", "status", "alert"];
const LINK_RELS: readonly LinkRel[] = ["nofollow", "noopener", "noreferrer", "ugc", "sponsored"];

export interface SanitizeOptions {
	allowedAttachmentIds?: ReadonlySet<string>;
	maxBlocks?: number;
}

function clampString(s: unknown, max: number): string {
	if (typeof s !== "string") return "";
	// eslint-disable-next-line no-control-regex
	const trimmed = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
	return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback?: T): T | undefined {
	return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function sanitizeBlock(raw: unknown, opts: SanitizeOptions): Block | null {
	if (!raw || typeof raw !== "object") return null;
	const r = raw as Record<string, unknown>;
	switch (r.type) {
		case "heading": {
			const level = [2, 3, 4, 5, 6].includes(r.level as number) ? (r.level as 2 | 3 | 4 | 5 | 6) : 2;
			return {
				type: "heading",
				level,
				text: clampString(r.text, HEADING_MAX),
				align: pickEnum(r.align, TEXT_ALIGNS),
				id: typeof r.id === "string" ? clampString(r.id, 80) : undefined,
			};
		}
		case "paragraph": {
			const marks = Array.isArray(r.marks)
				? (r.marks.filter((m) => TEXT_MARKS.includes(m as TextMark)) as TextMark[])
				: undefined;
			return {
				type: "paragraph",
				text: clampString(r.text, TEXT_MAX),
				align: pickEnum(r.align, TEXT_ALIGNS),
				marks: marks && marks.length ? marks : undefined,
			};
		}
		case "list": {
			const itemsRaw = Array.isArray(r.items) ? r.items.slice(0, MAX_LIST_ITEMS) : [];
			const items = itemsRaw.map((it) => clampString(it, LIST_ITEM_MAX)).filter((s) => s.length > 0);
			if (items.length === 0) return null;
			return {
				type: "list",
				ordered: r.ordered === true,
				items,
				start: typeof r.start === "number" && Number.isFinite(r.start) ? Math.floor(r.start) : undefined,
				ariaLabel: typeof r.ariaLabel === "string" ? clampString(r.ariaLabel, 200) : undefined,
			};
		}
		case "code": {
			return {
				type: "code",
				language: clampString(r.language, 40) || "plaintext",
				content: clampString(r.content, CODE_MAX),
				ariaLabel: typeof r.ariaLabel === "string" ? clampString(r.ariaLabel, 200) : undefined,
			};
		}
		case "callout": {
			return {
				type: "callout",
				tone: pickEnum(r.tone, CALLOUT_TONES, "info") as CalloutTone,
				role: pickEnum(r.role, CALLOUT_ROLES),
				text: clampString(r.text, TEXT_MAX),
			};
		}
		case "quote": {
			const rel = Array.isArray(r.rel)
				? (r.rel.filter((x) => LINK_RELS.includes(x as LinkRel)) as LinkRel[])
				: undefined;
			const url = typeof r.url === "string" ? clampString(r.url, 600) : undefined;
			const safeUrl = url && /^https?:\/\//i.test(url) ? url : undefined;
			return {
				type: "quote",
				text: clampString(r.text, TEXT_MAX),
				url: safeUrl,
				rel: rel && rel.length ? rel : undefined,
				ariaLabel: typeof r.ariaLabel === "string" ? clampString(r.ariaLabel, 200) : undefined,
			};
		}
		case "table": {
			const headerRaw = Array.isArray(r.header) ? r.header.slice(0, MAX_TABLE_COLS) : [];
			const header = headerRaw.map((c) => clampString(c, TABLE_CELL_MAX));
			const cols = header.length;
			if (cols === 0) return null;
			const rowsRaw = Array.isArray(r.rows) ? r.rows.slice(0, MAX_TABLE_ROWS) : [];
			const rows = rowsRaw.map((row) => {
				const arr = Array.isArray(row) ? row.slice(0, cols) : [];
				const padded = [...arr];
				while (padded.length < cols) padded.push("");
				return padded.map((c) => clampString(c, TABLE_CELL_MAX));
			});
			const columnAlign = Array.isArray(r.columnAlign)
				? (r.columnAlign.slice(0, cols).map((a) => pickEnum(a, TEXT_ALIGNS)).filter(Boolean) as TextAlign[])
				: undefined;
			return {
				type: "table",
				header,
				rows,
				columnAlign: columnAlign && columnAlign.length ? columnAlign : undefined,
				caption: typeof r.caption === "string" ? clampString(r.caption, 240) : undefined,
				rowHeaders: r.rowHeaders === true,
			};
		}
		case "attachment": {
			const attachmentId = typeof r.attachmentId === "string" ? r.attachmentId : "";
			if (!attachmentId) return null;
			if (opts.allowedAttachmentIds && !opts.allowedAttachmentIds.has(attachmentId)) return null;
			const kind = pickEnum(r.kind, ["image", "file"] as const, "file");
			return {
				type: "attachment",
				kind: kind!,
				attachmentId,
				fileName: clampString(r.fileName, 240) || "archivo",
				mimeType: clampString(r.mimeType, 120) || "application/octet-stream",
				size: typeof r.size === "number" && Number.isFinite(r.size) && r.size >= 0 ? Math.floor(r.size) : 0,
				alt: typeof r.alt === "string" ? clampString(r.alt, 240) : undefined,
				caption: typeof r.caption === "string" ? clampString(r.caption, 400) : undefined,
				align: pickEnum(r.align, TEXT_ALIGNS),
			};
		}
		case "divider":
			return { type: "divider" };
		default:
			return null;
	}
}

export function sanitizeBlocks(raw: unknown, opts: SanitizeOptions = {}): Block[] {
	if (!Array.isArray(raw)) return [];
	const max = opts.maxBlocks ?? 50;
	const out: Block[] = [];
	for (const item of raw) {
		const block = sanitizeBlock(item, opts);
		if (block) {
			out.push(block);
			if (out.length >= max) break;
		}
	}
	return out;
}

/** Devuelve un texto plano (primer párrafo o concat) útil para previews/`updateLog.reason`. */
export function blocksToPlainText(blocks: Block[], maxLen = 200): string {
	const parts: string[] = [];
	for (const b of blocks) {
		if (b.type === "paragraph" || b.type === "heading" || b.type === "quote" || b.type === "callout") {
			if (b.text) parts.push(b.text);
		} else if (b.type === "list") {
			parts.push(b.items.join(", "));
		} else if (b.type === "code") {
			parts.push(b.content);
		} else if (b.type === "attachment") {
			parts.push(`📎 ${b.fileName}`);
		}
		if (parts.join(" ").length > maxLen) break;
	}
	const txt = parts.join(" ").trim();
	return txt.length > maxLen ? txt.slice(0, maxLen - 1) + "…" : txt;
}

/** Extrae attachmentIds referenciados en bloques (para validar integridad). */
export function extractAttachmentIdsFromBlocks(blocks: Block[]): string[] {
	const ids: string[] = [];
	for (const b of blocks) if (b.type === "attachment" && b.attachmentId) ids.push(b.attachmentId);
	return ids;
}
