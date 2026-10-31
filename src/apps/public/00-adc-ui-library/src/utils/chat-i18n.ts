/**
 * Textos de los componentes de chat. Salen del namespace de la UI library (`chat.*`) y caen a estos
 * fallbacks si las traducciones todavía no cargaron; cada componente además deja pisarlos por prop.
 */

interface ADCGlobal {
	t?: (key: string, params?: Record<string, string> | null, namespace?: string) => string;
	getLocale?: () => string;
}

const adcI18n = globalThis as typeof globalThis & ADCGlobal;

const FALLBACKS = {
	es: {
		send: "Enviar",
		placeholder: "Escribí un mensaje…",
		replyingTo: "Respondiendo a",
		cancelReply: "Cancelar respuesta",
		typing: "Escribiendo…",
		newMessages: "Mensajes nuevos",
		loadOlder: "Cargar anteriores",
		loadingOlder: "Cargando…",
		empty: "Todavía no hay mensajes.",
		today: "Hoy",
		yesterday: "Ayer",
		"connection.live": "En vivo",
		"connection.polling": "Actualizando cada tanto",
		"connection.connecting": "Conectando…",
		"connection.offline": "Sin conexión",
		"status.sending": "Enviando…",
		"status.queued": "En cola",
		"status.sent": "Enviado",
		"status.read": "Leído",
		"status.done": "Respondido",
		"status.failed": "No se pudo enviar",
		log: "Conversación",
	},
	en: {
		send: "Send",
		placeholder: "Write a message…",
		replyingTo: "Replying to",
		cancelReply: "Cancel reply",
		typing: "Typing…",
		newMessages: "New messages",
		loadOlder: "Load earlier",
		loadingOlder: "Loading…",
		empty: "No messages yet.",
		today: "Today",
		yesterday: "Yesterday",
		"connection.live": "Live",
		"connection.polling": "Refreshing now and then",
		"connection.connecting": "Connecting…",
		"connection.offline": "Offline",
		"status.sending": "Sending…",
		"status.queued": "Queued",
		"status.sent": "Sent",
		"status.read": "Read",
		"status.done": "Answered",
		"status.failed": "Couldn't send",
		log: "Conversation",
	},
} as const;

export type ChatTextKey = keyof (typeof FALLBACKS)["es"];

function chatLocale(): "es" | "en" {
	const language = (adcI18n.getLocale?.() || globalThis.document?.documentElement?.lang || globalThis.navigator?.language || "").toLowerCase();
	return language.startsWith("en") ? "en" : "es";
}

export function chatText(key: ChatTextKey): string {
	const fullKey = `chat.${key}`;
	const translated = adcI18n.t?.(fullKey, null, "adc-ui-library");
	if (translated && translated !== fullKey) return translated;
	return FALLBACKS[chatLocale()][key];
}

/** Hora corta en el idioma de la UI ("14:05"). */
export function chatTime(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "";
	return date.toLocaleTimeString(chatLocale(), { hour: "2-digit", minute: "2-digit" });
}

/** Rótulo del separador de día: "Hoy", "Ayer" o la fecha. */
export function chatDayLabel(iso: string, now = new Date()): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "";
	const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
	const diff = Math.round((day(now) - day(date)) / 86_400_000);
	if (diff === 0) return chatText("today");
	if (diff === 1) return chatText("yesterday");
	return date.toLocaleDateString(chatLocale(), {
		weekday: "long",
		day: "numeric",
		month: "long",
		year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
	});
}

export function chatDayKey(iso: string): string {
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? "" : `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}
