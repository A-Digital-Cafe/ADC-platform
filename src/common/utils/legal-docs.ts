/**
 * Versión vigente de los documentos legales que la persona usuaria acepta al registrarse.
 *
 * Vive en `@common` porque tres capas distintas necesitan el mismo número y no pueden importarse
 * entre sí: la app `help` que publica los documentos, la app `adc-auth` que muestra la casilla de
 * aceptación y `SessionManagerService` que graba la constancia. Si cada una llevara su propia copia,
 * la constancia dejaría de probar *qué texto* se aceptó, que es justamente para lo que sirve.
 *
 * **Al editar un documento legal hay que subir su versión acá.** La versión es la fecha de
 * publicación en formato ISO: coincide con el `lastUpdated` que muestra la página y ordena sola.
 */

export const LEGAL_DOCUMENTS = {
	terms: { id: "terms", version: "2026-08-05", href: "/terms" },
	privacy: { id: "privacy", version: "2026-08-05", href: "/privacy" },
} as const;

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
	/** Cómo se prestó: casilla explícita del formulario o continuación con un proveedor OAuth. */
	via: "register-form" | "oauth";
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
