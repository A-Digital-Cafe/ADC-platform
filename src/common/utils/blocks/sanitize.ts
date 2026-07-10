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
const MAX_MENTIONS = 20;
const MENTION_ID_MAX = 64;

const TEXT_ALIGNS: readonly TextAlign[] = ["left", "center", "right"];
const TEXT_MARKS: ReadonlySet<TextMark> = new Set(["bold", "italic", "code"]);
const CALLOUT_TONES: readonly CalloutTone[] = ["info", "warning", "success", "error"];
const CALLOUT_ROLES: readonly CalloutRole[] = ["note", "status", "alert"];
const LINK_RELS: ReadonlySet<LinkRel> = new Set(["nofollow", "noopener", "noreferrer", "ugc", "sponsored"]);

interface SanitizeOptions {
	allowedAttachmentIds?: ReadonlySet<string>;
	maxBlocks?: number;
}

function clampString(s: unknown, max: number): string {
	if (typeof s !== "string") return "";
	// eslint-disable-next-line no-control-regex
	const trimmed = s.replaceAll(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
	return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback?: T): T | undefined {
	return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** IDs de usuarios mencionados: array de strings acotado y deduplicado, o `undefined`. */
function sanitizeMentions(raw: unknown): string[] | undefined {
	if (!Array.isArray(raw)) return undefined;
	const ids = raw.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= MENTION_ID_MAX);
	const unique = Array.from(new Set(ids)).slice(0, MAX_MENTIONS);
	return unique.length ? unique : undefined;
}

/** `clampString` solo si el valor era string; si no, `undefined` (campos opcionales). */
function optionalString(value: unknown, max: number): string | undefined {
	return typeof value === "string" ? clampString(value, max) : undefined;
}

/** Marks de texto válidas, o `undefined` si no queda ninguna. */
function sanitizeMarks(raw: unknown): TextMark[] | undefined {
	const marks = Array.isArray(raw) ? (raw.filter((m) => TEXT_MARKS.has(m as TextMark)) as TextMark[]) : undefined;
	return marks?.length ? marks : undefined;
}

type Raw = Record<string, unknown>;

function sanitizeHeading(r: Raw): Block {
	const level = [2, 3, 4, 5, 6].includes(r.level as number) ? (r.level as 2 | 3 | 4 | 5 | 6) : 2;
	return {
		type: "heading",
		level,
		text: clampString(r.text, HEADING_MAX),
		align: pickEnum(r.align, TEXT_ALIGNS),
		id: optionalString(r.id, 80),
		mentions: sanitizeMentions(r.mentions),
	};
}

function sanitizeParagraph(r: Raw): Block {
	return {
		type: "paragraph",
		text: clampString(r.text, TEXT_MAX),
		align: pickEnum(r.align, TEXT_ALIGNS),
		marks: sanitizeMarks(r.marks),
		mentions: sanitizeMentions(r.mentions),
	};
}

function sanitizeCheckbox(r: Raw): Block {
	return {
		type: "checkbox",
		checked: r.checked === true,
		text: clampString(r.text, TEXT_MAX),
		align: pickEnum(r.align, TEXT_ALIGNS),
		marks: sanitizeMarks(r.marks),
		mentions: sanitizeMentions(r.mentions),
	};
}

function sanitizeList(r: Raw): Block | null {
	const itemsRaw = Array.isArray(r.items) ? r.items.slice(0, MAX_LIST_ITEMS) : [];
	const items = itemsRaw.map((it) => clampString(it, LIST_ITEM_MAX)).filter((s) => s.length > 0);
	if (items.length === 0) return null;
	return {
		type: "list",
		ordered: r.ordered === true,
		items,
		start: typeof r.start === "number" && Number.isFinite(r.start) ? Math.floor(r.start) : undefined,
		ariaLabel: optionalString(r.ariaLabel, 200),
	};
}

function sanitizeCode(r: Raw): Block {
	return {
		type: "code",
		language: clampString(r.language, 40) || "plaintext",
		content: clampString(r.content, CODE_MAX),
		ariaLabel: optionalString(r.ariaLabel, 200),
	};
}

function sanitizeCallout(r: Raw): Block {
	return {
		type: "callout",
		tone: pickEnum(r.tone, CALLOUT_TONES, "info") as CalloutTone,
		role: pickEnum(r.role, CALLOUT_ROLES),
		text: clampString(r.text, TEXT_MAX),
		mentions: sanitizeMentions(r.mentions),
	};
}

function sanitizeQuote(r: Raw): Block {
	const rel = Array.isArray(r.rel) ? (r.rel.filter((x) => LINK_RELS.has(x as LinkRel)) as LinkRel[]) : undefined;
	const url = optionalString(r.url, 600);
	const safeUrl = url && /^https?:\/\//i.test(url) ? url : undefined;
	return {
		type: "quote",
		text: clampString(r.text, TEXT_MAX),
		url: safeUrl,
		rel: rel?.length ? rel : undefined,
		ariaLabel: optionalString(r.ariaLabel, 200),
		mentions: sanitizeMentions(r.mentions),
	};
}

function sanitizeTable(r: Raw): Block | null {
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
		? (r.columnAlign
				.slice(0, cols)
				.map((a) => pickEnum(a, TEXT_ALIGNS))
				.filter(Boolean) as TextAlign[])
		: undefined;
	return {
		type: "table",
		header,
		rows,
		columnAlign: columnAlign?.length ? columnAlign : undefined,
		caption: optionalString(r.caption, 240),
		rowHeaders: r.rowHeaders === true,
	};
}

function sanitizeAttachment(r: Raw, opts: SanitizeOptions): Block | null {
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
		alt: optionalString(r.alt, 240),
		caption: optionalString(r.caption, 400),
		align: pickEnum(r.align, TEXT_ALIGNS),
	};
}

/** Un sanitizador por tipo de bloque; tipo desconocido → se descarta. */
const BLOCK_SANITIZERS: Record<string, (r: Raw, opts: SanitizeOptions) => Block | null> = {
	heading: sanitizeHeading,
	paragraph: sanitizeParagraph,
	checkbox: sanitizeCheckbox,
	list: sanitizeList,
	code: sanitizeCode,
	callout: sanitizeCallout,
	quote: sanitizeQuote,
	table: sanitizeTable,
	attachment: sanitizeAttachment,
	divider: () => ({ type: "divider" }),
};

function sanitizeBlock(raw: unknown, opts: SanitizeOptions): Block | null {
	if (!raw || typeof raw !== "object") return null;
	const r = raw as Raw;
	const sanitizer = typeof r.type === "string" ? BLOCK_SANITIZERS[r.type] : undefined;
	return sanitizer ? sanitizer(r, opts) : null;
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

/** Extrae attachmentIds referenciados en bloques (para validar integridad). */
export function extractAttachmentIdsFromBlocks(blocks: Block[]): string[] {
	const ids: string[] = [];
	for (const b of blocks) if (b.type === "attachment" && b.attachmentId) ids.push(b.attachmentId);
	return ids;
}
