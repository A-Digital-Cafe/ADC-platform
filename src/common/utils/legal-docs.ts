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
		// Corregida el 2026-08-10 sin bump por el mismo criterio que privacy: no rige hasta el
		// 2026-09-07. La tabla de edad mínima por país deja de enumerar Estados miembros de la UE
		// (ver el memo de alcance territorial en el repo privado) y pasa a una regla única de 13
		// años; el resto de los países queda como referencia informativa, no vinculante.
		// sha256sum presets/help/apps/help/src/pages/TermsPage.tsx
		contentHash: "af5fff04d3f66786b7c67de8380ded94dba19960d4942919562f6ed40bf02d78",
	},
	privacy: {
		id: "privacy",
		label: "Política de Privacidad",
		version: "2026-08-08",
		effectiveFrom: "2026-09-07",
		href: "/privacy",
		requiresAcceptance: true,
		// La 2026-08-08 tuvo erratas/ampliaciones antes de entrar en vigencia (leyenda AAIP,
		// derechos self-service, plazos de archivo, alcance de la rectificación y de la baja) y una
		// segunda tanda el 2026-08-09: plazos de retención de correo y de tickets ahora que el código
		// los aplica, §6 sin nombrar el algoritmo de hashing (ya no es PBKDF2) y §13 nueva sobre datos
		// de colaboradores. Y una tercera el 2026-08-10: la inscripción en el RNBD en §1, y el servidor
		// STUN de Google —que el túnel P2P ya usaba sin declararlo— en §7 y en el párrafo del túnel.
		// Y una cuarta el 2026-08-12, de cara al plan de escalabilidad: las filas de infraestructura propia
		// de §7 admiten ahora varios servidores replicados (la redacción anterior daba a entender una sola
		// máquina), la fila de logs de §5 dice "cada proceso" y se compromete a no escribirlos a disco ni
		// mandarlos a terceros, §6 suma el régimen de réplicas y copias de seguridad (cifradas, 30 días, sin
		// restaurar datos ya suprimidos) y §8 promete anuncio previo + re-declaración ante el RNBD si alguna
		// vez hubiera infraestructura propia fuera del país. Cada una de esas frases habría exigido una
		// enmienda con 30 días de preaviso el día que se sumara el segundo nodo.
		// Se corrige en lugar de versionar porque el documento todavía NO rige: una
		// versión nueva pediría re-aceptar algo que nadie aceptó, y todo lo agregado amplía derechos o
		// informa de más, nunca recorta. Contrapartida asumida: las altas posteriores al 2026-08-08
		// llevan sellado el hash anterior, recuperable del historial de git. Queda en git.
		// sha256sum presets/help/apps/help/src/pages/PrivacyPage.tsx
		contentHash: "9abe6ca74dfec78f87fedc1bb0987787986ed1268d09dfb04398e8150a0d4bd1",
	},
	cookies: {
		id: "cookies",
		label: "Cookies y tecnologías similares",
		version: "2026-08-08",
		effectiveFrom: "2026-09-07",
		href: "/cookies",
		requiresAcceptance: false,
		// Corregida el 2026-08-09 sin bump por el mismo criterio que privacy: la lista de terceros de
		// §6 se acortó (React y las fotos de Discord dejaron de servirse desde un CDN ajeno), así que
		// el texto pasa a declarar MENOS terceros de los que declaraba. No rige hasta el 2026-09-07.
		// Corregida otra vez el 2026-08-10, esta vez sumando uno: el servidor STUN de Google que el
		// túnel P2P del Drive contacta al abrir una transferencia entre dispositivos.
		// Y una tercera el 2026-08-12: §2 declara la cookie técnica `adc_build`, que fija la sesión de
		// navegación a un nodo mientras los artefactos de UI no estén igualados entre nodos (si no, el
		// documento sale de un nodo y sus chunks de otro → 404 intermitentes). Se declara ANTES de que
		// exista: sólo se escribe con ADC_CLUSTER_GATEWAY=true y algún vecino vivo, o sea que con un
		// solo nodo no se crea nunca, y la fila lo dice. Mismo criterio que las correcciones de arriba:
		// sin bump porque el documento no rige hasta el 2026-09-07 —versionar pediría re-aceptar algo
		// que nadie aceptó— y porque declarar una cookie de más nunca recorta lo que ya se prometió.
		// Declararla recién el día que se encienda el segundo nodo sí habría exigido enmienda con 30
		// días de preaviso, y esa espera bloquearía el despliegue.
		// Y una cuarta el 2026-08-15, por el mismo criterio: §5 declara que respetamos **Global Privacy
		// Control** (sin el script de analítica cuando el navegador manda `Sec-GPC`), y se corrige quién
		// inserta ese script —lo inyecta la plataforma, no el proxy de Cloudflare— porque es lo que hace
		// posible la decisión por visita. Suma un derecho y precisa un hecho: no recorta nada.
		// sha256sum presets/help/apps/help/src/pages/CookiesPage.tsx
		contentHash: "4fee0cb26c6a78f27a9394008afaf3cd76d3e755e20de2913ae8815f25475f55",
	},
	dpa: {
		id: "dpa",
		label: "Acuerdo de Tratamiento de Datos (DPA)",
		version: "2026-08-08",
		effectiveFrom: "2026-09-07",
		href: "/dpa",
		requiresAcceptance: false,
		// Corregida el 2026-08-10 sin bump por el mismo criterio que privacy: no rige hasta el
		// 2026-09-07. Se excluye a organizaciones establecidas en el EEE (declaración, garantía e
		// indemnidad), ver el memo de alcance territorial en el repo privado.
		// Corregida otra vez el 2026-08-12, de cara al plan de escalabilidad: §7 suma redundancia de la
		// infraestructura y copias de seguridad cifradas a las medidas técnicas, y §8 aclara que operar
		// sobre varios servidores propios NO es alta de subencargado (sí lo sería un alojamiento o un
		// backup de terceros, que mantiene el aviso previo y el derecho a terminar el plan).
		// sha256sum presets/help/apps/help/src/pages/DpaPage.tsx
		contentHash: "cd64ee99f3eb81476e684ff437fc2c29f5598517470110527ca43f91c54b025d",
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
