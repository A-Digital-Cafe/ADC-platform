/**
 * Sanitiza un mensaje proveniente de query string para mostrarlo en UI.
 * - Limita longitud
 * - Elimina caracteres de control
 * - No interpreta HTML (React ya escapa)
 */
export function sanitizeMessage(raw: string | null | undefined, max = 300): string {
	if (!raw) return "";
	// Quita caracteres de control y normaliza espacios
	const cleaned = raw.replace(/[\u0000-\u001F\u007F]+/g, " ").trim();
	if (cleaned.length <= max) return cleaned;
	return `${cleaned.slice(0, max)}…`;
}

/** Lee un query param y lo sanitiza */
export function readParam(name: string, max?: number): string {
	const params = new URLSearchParams(globalThis.location?.search || "");
	return sanitizeMessage(params.get(name), max);
}
