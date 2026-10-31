/**
 * Modelo del chat genérico de la UI library (`adc-chat-thread`, `adc-chat-message`,
 * `adc-chat-composer`). Es de presentación: cada app traduce sus mensajes a esto y responde a los
 * eventos `adcChat*`. Sirve igual para un bot con respuestas interactivas (Sumi) que para un chat
 * entre personas (`PLAN-chats-email.md`).
 */

/** @public */
export type ChatSide = "self" | "other" | "system";

/** @public */
export interface ChatAuthor {
	id: string;
	name?: string;
	/** URL del avatar. Sin ella se pinta la inicial. */
	avatar?: string | null;
	kind?: "user" | "bot" | "system";
}

export type ChatTone = "neutral" | "info" | "success" | "warning" | "danger";

/** Un botón. `id` vuelve tal cual en el evento: la app decide qué significa. */
export interface ChatAction {
	id: string;
	label: string;
	/** Tooltip y nombre accesible si el label es un ícono o un emoji. */
	ariaLabel?: string;
	variant?: "default" | "primary" | "danger" | "link";
	/** Toggle (reacciones): se marca con `aria-pressed`. */
	pressed?: boolean;
	disabled?: boolean;
}

/**
 * Respuesta sugerida: tocarla equivale a contestar con `value` (o el `label`).
 * @public
 */
export interface ChatSuggestion {
	id: string;
	label: string;
	value?: string;
}

export type ChatBlock =
	| { type: "text" | "paragraph"; text: string }
	| { type: "heading"; text: string }
	| { type: "quote"; text: string }
	| { type: "code"; text: string }
	| { type: "list"; items: string[]; ordered?: boolean }
	| { type: "chips"; items: Array<{ label: string; tone?: ChatTone; title?: string }> }
	| { type: "actions"; actions: ChatAction[] }
	| { type: "disclosure"; key: string; summary: string; open?: boolean; blocks: ChatBlock[] }
	| { type: "card"; title?: string; tone?: ChatTone; blocks: ChatBlock[]; actions?: ChatAction[] };

/** Una burbuja. Un mensaje puede tener varias (un bot que contesta en N oraciones). */
export interface ChatPart {
	key: string;
	variant?: "default" | "muted" | "emphasis" | "error";
	/** `invite` resalta la burbuja hasta que la persona actúe; `pulse` además late (respeta reduced-motion). */
	highlight?: "none" | "invite" | "pulse";
	blocks: ChatBlock[];
	suggestions?: ChatSuggestion[];
	/** Toggles bajo la burbuja (👍/👎). */
	reactions?: ChatAction[];
	/** Línea chica al pie (lo que contestó el sistema a una reacción, un aviso). */
	note?: string;
}

/** @public */
export interface ChatMeta {
	id: string;
	label: string;
	title?: string;
	/** Si está, el chip es una cita: tocarlo lleva a ese mensaje. */
	targetKey?: string;
}

export type ChatStatus = "sending" | "queued" | "sent" | "read" | "done" | "failed";

export interface ChatReceipt {
	/** Texto del tooltip/estado ("escuchado", "respondido"). */
	label?: string;
	details?: Array<{ text: string; at?: string }>;
}

export interface ChatItem {
	key: string;
	side: ChatSide;
	author?: ChatAuthor;
	/** ISO 8601. */
	at: string;
	parts: ChatPart[];
	meta?: ChatMeta[];
	/** Acciones del mensaje entero (responder, detener, reintentar). */
	actions?: ChatAction[];
	status?: ChatStatus;
	receipt?: ChatReceipt;
	replyTo?: { key: string; preview: string };
}

export type ChatConnection = "live" | "polling" | "connecting" | "offline";

export interface ChatReplyTarget {
	key: string;
	preview: string;
}

// ── Detalles de los eventos `adcChat*` ───────────────────────────────────────────

export interface ChatSubmitDetail {
	text: string;
	replyToKey?: string;
}
export interface ChatActionDetail {
	/** Dónde estaba el botón: en un mensaje, en una burbuja (o un bloque suyo), en el encabezado o en el composer. */
	scope: "item" | "part" | "header" | "composer";
	itemKey?: string;
	partKey?: string;
	actionId: string;
}
export interface ChatSuggestionDetail {
	itemKey: string;
	partKey: string;
	id: string;
	value: string;
}
export interface ChatReactionDetail {
	itemKey: string;
	partKey: string;
	id: string;
	/** Estado nuevo pedido (el contrario del actual). */
	pressed: boolean;
}
export interface ChatQuoteDetail {
	targetKey: string;
	/** `false` si el mensaje citado no está cargado: la app puede traer más historial. */
	found?: boolean;
}
