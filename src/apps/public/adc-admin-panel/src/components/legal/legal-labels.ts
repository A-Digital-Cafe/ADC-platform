import type { LegalDocOverview, LegalRunKind } from "../../utils/legal-api.ts";

/** Etiquetas de la tab «Legales». Separadas del render para que las tarjetas se lean de un vistazo. */

export const RUN_LABELS: Record<LegalRunKind, string> = {
	pdf: "PDF",
	announce: "Aviso",
	rebuild: "Regeneración",
};

/** Fecha ISO `YYYY-MM-DD` → `dd/mm`. Las fechas legales no llevan hora. */
export function shortDate(iso: string): string {
	const [, m, d] = iso.split("-");
	return d ? `${d}/${m}` : iso;
}

/**
 * La frase de estado que va bajo el título: en reposo es lo único que se lee de la tarjeta.
 *
 * Distingue el momento en que hay algo que decidir: mientras el documento no rige, corregir el
 * texto es gratis; una vez vigente, la misma edición cuesta una versión nueva y 30 días de espera.
 */
export function stateLine(doc: LegalDocOverview): string {
	if (doc.state === "en-preaviso") {
		const days = doc.daysUntilEffective;
		const when = days === 1 ? "mañana" : `en ${days} días`;
		return `v${doc.version} · en preaviso · rige ${when} (${doc.effectiveFrom})`;
	}
	return `v${doc.version} · vigente desde el ${doc.effectiveFrom}`;
}

/** Tono del badge de estado. `warning` = hay algo pendiente en esta tarjeta. */
export function stateTone(doc: LegalDocOverview): { color: "green" | "blue" | "orange" | "red"; text: string } {
	if (doc.drifted) return { color: "orange", text: "Texto modificado" };
	if (doc.deployedHash === null) return { color: "red", text: "Fuente ausente" };
	if (!doc.noticeOk) return { color: "red", text: "Preaviso corto" };
	if (!doc.pdf) return { color: "orange", text: "Sin PDF" };
	return doc.state === "en-preaviso" ? { color: "blue", text: "En preaviso" } : { color: "green", text: "Vigente" };
}

/** `true` si la tarjeta tiene algo que resolver y por lo tanto conviene abrirla sola. */
export function needsAttention(doc: LegalDocOverview): boolean {
	return doc.drifted || doc.deployedHash === null || !doc.noticeOk || !doc.pdf;
}

/** Hash abreviado para mostrar sin ocupar la fila entera. */
export function shortHash(hash: string): string {
	return `${hash.slice(0, 8)}…${hash.slice(-7)}`;
}

/** Bytes → `41 KB`. Los PDF legales pesan decenas de KB. */
export function humanBytes(bytes: number): string {
	return bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`;
}
