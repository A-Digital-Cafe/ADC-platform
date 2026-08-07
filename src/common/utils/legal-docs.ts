/**
 * Versión vigente de los documentos legales y desde cuándo rige cada una.
 *
 * Vive en `@common` porque tres capas distintas necesitan el mismo número y no pueden importarse
 * entre sí: la app `help` que publica los documentos, la app `adc-auth` que muestra la casilla de
 * aceptación y `SessionManagerService` que graba la constancia. Si cada una llevara su propia copia,
 * la constancia dejaría de probar *qué texto* se aceptó, que es justamente para lo que sirve.
 *
 * **Al editar un documento legal hay que subir su versión acá.** `version` es la fecha de
 * publicación en formato ISO: coincide con el `lastUpdated` que muestra la página y ordena sola.
 *
 * `effectiveFrom` es la fecha desde la que esa versión rige **para las cuentas que ya existían**, y
 * tiene que estar al menos `MIN_LEGAL_NOTICE_DAYS` días después de `version`. Los Términos prometen
 * ese preaviso, y una versión que entra en vigor el día del despliegue lo incumple: el aviso sale
 * cuando se publica, la exigencia de re-aceptar recién cuando llega `effectiveFrom`. Para el alta
 * `effectiveFrom` no juega — quien se registra hoy acepta en el acto la versión vigente.
 */

/** Preaviso mínimo entre publicar un documento y que rija para las cuentas preexistentes. */
export const MIN_LEGAL_NOTICE_DAYS = 30;

export const LEGAL_DOCUMENTS = {
	terms: { id: "terms", label: "Términos y Condiciones", version: "2026-08-07", effectiveFrom: "2026-09-06", href: "/terms" },
	privacy: { id: "privacy", label: "Política de Privacidad", version: "2026-08-07", effectiveFrom: "2026-09-06", href: "/privacy" },
} as const;

type LegalDocumentId = keyof typeof LEGAL_DOCUMENTS;

export interface LegalDocument {
	id: LegalDocumentId;
	/** Nombre con el que se lo llama en avisos y pantallas. */
	label: string;
	/** Fecha de publicación (ISO `YYYY-MM-DD`). */
	version: string;
	/** Fecha (ISO `YYYY-MM-DD`) desde la que rige para las cuentas preexistentes. */
	effectiveFrom: string;
	href: string;
}

/** Lista estable para iterar (mismo orden en avisos y en la pantalla de re-aceptación). */
export const LEGAL_DOCUMENT_LIST: readonly LegalDocument[] = [LEGAL_DOCUMENTS.terms, LEGAL_DOCUMENTS.privacy];

/** Edad mínima general de la plataforma. Algunos países exigen más (ver /terms#edad-minima). */
export const MIN_AGE = 13;

/** Constancia de aceptación que se guarda junto al usuario. Las fechas las pone el servidor. */
export interface LegalAcceptance {
	termsVersion: string;
	privacyVersion: string;
	/** Autodeclaración de edad mínima. Sin verificación documental: traslada la responsabilidad. */
	ageConfirmed: boolean;
	/** ISO 8601, sellado en el servidor: un timestamp de cliente no prueba nada. */
	acceptedAt: string;
	/** Cómo se prestó: casilla del alta, continuación con OAuth, o re-aceptación de una versión nueva. */
	via: "register-form" | "oauth" | "re-acceptance";
}

/** Versiones vigentes, en el formato que espera el endpoint de registro. */
export function currentLegalVersions(): { termsVersion: string; privacyVersion: string } {
	return { termsVersion: LEGAL_DOCUMENTS.terms.version, privacyVersion: LEGAL_DOCUMENTS.privacy.version };
}

/**
 * Construye la constancia sellando la fecha en el servidor.
 * No acepta versiones del cliente: siempre graba las vigentes, que son las que el usuario vio.
 */
export function buildLegalAcceptance(via: LegalAcceptance["via"], ageConfirmed: boolean): LegalAcceptance {
	return { ...currentLegalVersions(), ageConfirmed, acceptedAt: new Date().toISOString(), via };
}

/** Días reales de preaviso de un documento: de su publicación a su entrada en vigor. */
export function legalNoticeDays(doc: LegalDocument): number {
	const days = (Date.parse(doc.effectiveFrom) - Date.parse(doc.version)) / 86_400_000;
	return Number.isFinite(days) ? Math.floor(days) : 0;
}

/**
 * Documentos que la persona tiene que volver a aceptar: los que ya entraron en vigor y cuya
 * versión es posterior a la que consta aceptada. Vacío = nada pendiente.
 *
 * Una cuenta sin constancia (anterior a que se guardara) cuenta como no aceptada, pero tampoco
 * antes de `effectiveFrom`: el preaviso corre igual para ella.
 */
export function pendingLegalDocs(acceptance?: Partial<LegalAcceptance> | null, now: Date = new Date()): LegalDocument[] {
	return LEGAL_DOCUMENT_LIST.filter((doc) => {
		if (Date.parse(doc.effectiveFrom) > now.getTime()) return false;
		const accepted = doc.id === "terms" ? acceptance?.termsVersion : acceptance?.privacyVersion;
		return !accepted || accepted < doc.version;
	});
}
