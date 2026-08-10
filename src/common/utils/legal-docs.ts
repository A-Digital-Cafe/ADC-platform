/**
 * Versión vigente de los documentos legales y desde cuándo rige cada una.
 *
 * Vive en `@common` porque tres capas distintas necesitan el mismo número y no pueden importarse
 * entre sí: la app `help` que publica los documentos, la app `adc-auth` que muestra la casilla de
 * aceptación y `SessionManagerService` que graba la constancia. Si cada una llevara su propia copia,
 * la constancia dejaría de probar *qué texto* se aceptó, que es justamente para lo que sirve.
 *
 * **Al editar un documento legal hay que subir su versión acá y regenerar su `contentHash`**
 * (`sha256sum` del archivo fuente, ruta en cada entrada). `version` es la fecha de publicación ISO,
 * la misma que muestra la página. El hash viaja a la constancia e identifica *el texto exacto* que
 * se aceptó —recuperable del historial git—, no sólo su fecha.
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
	terms: {
		id: "terms",
		label: "Términos y Condiciones",
		version: "2026-08-08",
		effectiveFrom: "2026-09-07",
		href: "/terms",
		requiresAcceptance: true,
		// sha256sum presets/help/apps/help/src/pages/TermsPage.tsx
		contentHash: "9877c497c88caaa210bd54ac0d903300061b502fdc9a1efdb55ff91c963755c7",
	},
	privacy: {
		id: "privacy",
		label: "Política de Privacidad",
		version: "2026-08-08",
		effectiveFrom: "2026-09-07",
		href: "/privacy",
		requiresAcceptance: true,
		// La 2026-08-08 tuvo erratas/ampliaciones antes de entrar en vigencia (leyenda AAIP,
		// derechos self-service, plazos de archivo, alcance de la rectificación y de la baja). Se
		// corrige en lugar de versionar porque el documento todavía NO rige y nadie pudo aceptar el
		// texto viejo: una versión nueva pediría re-aceptar algo que nadie aceptó. Queda en git.
		// sha256sum presets/help/apps/help/src/pages/PrivacyPage.tsx
		contentHash: "c2132ee2706566a8572f3a12c67f983bca48fb88679499e79d6693eb8d7d4ccb",
	},
	cookies: {
		id: "cookies",
		label: "Cookies y tecnologías similares",
		version: "2026-08-08",
		effectiveFrom: "2026-09-07",
		href: "/cookies",
		requiresAcceptance: false,
		// sha256sum presets/help/apps/help/src/pages/CookiesPage.tsx
		contentHash: "965d6c50ecc7eddcd53fd50d971c00291bdb46f0d32ba323c5d57fd155ec4f18",
	},
	dpa: {
		id: "dpa",
		label: "Acuerdo de Tratamiento de Datos (DPA)",
		version: "2026-08-08",
		effectiveFrom: "2026-09-07",
		href: "/dpa",
		requiresAcceptance: false,
		// sha256sum presets/help/apps/help/src/pages/DpaPage.tsx
		contentHash: "b20fcb6c159bcd9ab20ad8681c8d3d1750690b3a43d23c568640b0ee7621d206",
	},
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
	/**
	 * `true` sólo para los documentos que se aceptan en el alta y se re-aceptan al cambiar (los de
	 * `LEGAL_DOCUMENT_LIST`, los únicos que conoce `LegalAcceptance`). Los informativos (cookies,
	 * DPA) se versionan y congelan igual y su bump se anuncia, pero sin exigir re-aceptación — el
	 * preaviso de 30 días lo prometen también Privacidad §7 y DPA §15.
	 */
	requiresAcceptance: boolean;
	/** SHA-256 del archivo fuente de la página en esta versión (ver nota de cabecera). */
	contentHash: string;
}

/**
 * Sólo los documentos que requieren aceptación, en orden estable (el mismo en avisos y en la
 * pantalla de re-aceptación): `pendingLegalDocs()` y `LegalAcceptance` sólo saben de terms/privacy.
 * El anunciador de cambios itera `LEGAL_DOCUMENTS` completo, no esta lista.
 */
const LEGAL_DOCUMENT_LIST: readonly LegalDocument[] = [LEGAL_DOCUMENTS.terms, LEGAL_DOCUMENTS.privacy];

/** Edad mínima general de la plataforma. Algunos países exigen más (ver /terms#edad-minima). */
export const MIN_AGE = 13;

/** Constancia de aceptación que se guarda junto al usuario. Las fechas las pone el servidor. */
export interface LegalAcceptance {
	termsVersion: string;
	privacyVersion: string;
	/** SHA-256 del texto aceptado (ausente en constancias anteriores a 2026-08-07). */
	termsHash?: string;
	privacyHash?: string;
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
	return {
		...currentLegalVersions(),
		termsHash: LEGAL_DOCUMENTS.terms.contentHash,
		privacyHash: LEGAL_DOCUMENTS.privacy.contentHash,
		ageConfirmed,
		acceptedAt: new Date().toISOString(),
		via,
	};
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
