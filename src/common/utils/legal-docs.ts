/**
 * Versión vigente de los documentos legales y desde cuándo rige cada una.
 *
 * Vive en `@common` porque tres capas distintas necesitan el mismo número y no pueden importarse
 * entre sí: la app `help` que publica los documentos, la app `adc-auth` que muestra la casilla de
 * aceptación y `SessionManagerService` que graba la constancia. Si cada una llevara su propia copia,
 * la constancia dejaría de probar *qué texto* se aceptó, que es justamente para lo que sirve.
 *
 * **Este archivo es metadata: el texto vive en el `.tsx` que apunta `sourcePath` y los dos viajan
 * juntos en el mismo despliegue.** Por eso la versión no se administra desde una base de datos —
 * un nodo podría servir un texto y la base afirmar otro número.
 *
 * `contentHash` es el `sha256sum` de ese archivo y viaja a la constancia: identifica *el texto
 * exacto* que se aceptó —recuperable del historial git—, no sólo su fecha. **No se mantiene a
 * ojo**: `scripts/legal-check.mjs` (dentro de `bun run extra-checks`) lo recalcula y avisa, y la
 * tab «Legales» del panel de administración lo muestra en vivo contra el archivo desplegado.
 *
 * `effectiveFrom` es la fecha desde la que esa versión rige **para las cuentas que ya existían**, y
 * tiene que estar al menos `MIN_LEGAL_NOTICE_DAYS` días después de `version`. Los Términos prometen
 * ese preaviso, y una versión que entra en vigor el día del despliegue lo incumple: el aviso sale
 * cuando se publica, la exigencia de re-aceptar recién cuando llega `effectiveFrom`. Para el alta
 * `effectiveFrom` no juega — quien se registra hoy acepta en el acto la versión vigente.
 *
 * Mientras `hoy < effectiveFrom` el documento **no rige todavía**, y entonces corregirlo sólo pide
 * actualizar el `contentHash`: versionar pediría re-aceptar algo que nadie aceptó. Cada corrección
 * así queda asentada en `corrections` (ver {@link LegalCorrection}), que es la trazabilidad de por
 * qué esa versión dice hoy algo distinto de lo que decía el día que se publicó.
 */

/** Preaviso mínimo entre publicar un documento y que rija para las cuentas preexistentes. */
export const MIN_LEGAL_NOTICE_DAYS = 30;

/**
 * Corrección aplicada a una versión **antes** de que entrara en vigor.
 *
 * La condición para corregir en lugar de versionar es que el cambio amplíe derechos, asuma
 * obligaciones o informe de más — nunca que recorte. La contrapartida asumida: las altas
 * anteriores a la corrección llevan sellado el hash previo, recuperable del historial de git.
 */
export interface LegalCorrection {
	/** Fecha ISO `YYYY-MM-DD` en que se aplicó. */
	date: string;
	/** Qué cambió, en una o dos oraciones. Lo lee la tab «Legales» del panel. */
	summary: string;
}

export const LEGAL_DOCUMENTS = {
	terms: {
		id: "terms",
		label: "Términos y Condiciones",
		version: "2026-08-08",
		effectiveFrom: "2026-09-07",
		href: "/terms",
		requiresAcceptance: true,
		sourcePath: "presets/help/apps/help/src/pages/TermsPage.tsx",
		contentHash: "2676cf2bd3b3e8f27a3c332825110c5d30dc1b43ebcb6c0bddfdc21b7f8aa043",
		corrections: [
			{
				date: "2026-08-10",
				summary:
					"La tabla de edad mínima por país deja de enumerar Estados miembros de la UE (ver el memo de alcance territorial en el repo privado) y pasa a una regla única de 13 años; el resto de los países queda como referencia informativa, no vinculante.",
			},
			{
				date: "2026-08-20",
				summary:
					"De cara al subdominio de generadores (`gen`): §6 suma el contenido que se crea CON las herramientas —es del usuario, uso comercial incluido, sin licencia para nosotros más allá de guardárselo—, §8 declara el subdominio y sus dos avisos propios (licencias de tipografías y accesibilidad del texto Unicode decorativo), y §10 extiende el «tal cual» al resultado de las herramientas dejando a cargo nuestro que la herramienta haga lo que dice y que sus componentes de terceros estén licenciados.",
			},
		],
	},
	privacy: {
		id: "privacy",
		label: "Política de Privacidad",
		version: "2026-08-08",
		effectiveFrom: "2026-09-07",
		href: "/privacy",
		requiresAcceptance: true,
		sourcePath: "presets/help/apps/help/src/pages/PrivacyPage.tsx",
		contentHash: "9abe6ca74dfec78f87fedc1bb0987787986ed1268d09dfb04398e8150a0d4bd1",
		corrections: [
			{
				date: "2026-08-08",
				summary:
					"Erratas y ampliaciones el mismo día de publicarla: leyenda AAIP, derechos self-service, plazos de archivo, y alcance de la rectificación y de la baja.",
			},
			{
				date: "2026-08-09",
				summary:
					"Plazos de retención de correo y de tickets, ahora que el código los aplica; §6 deja de nombrar el algoritmo de hashing (ya no es PBKDF2); §13 nueva sobre datos de colaboradores.",
			},
			{
				date: "2026-08-10",
				summary:
					"La inscripción en el RNBD en §1, y el servidor STUN de Google —que el túnel P2P ya usaba sin declararlo— en §7 y en el párrafo del túnel.",
			},
			{
				date: "2026-08-12",
				summary:
					"De cara al plan de escalabilidad: las filas de infraestructura propia de §7 admiten varios servidores replicados (la redacción anterior daba a entender una sola máquina), la fila de logs de §5 dice «cada proceso» y se compromete a no escribirlos a disco ni mandarlos a terceros, §6 suma el régimen de réplicas y copias de seguridad (cifradas, 30 días, sin restaurar datos ya suprimidos), y §8 promete anuncio previo + re-declaración ante el RNBD si alguna vez hubiera infraestructura propia fuera del país. Cada una de esas frases habría exigido una enmienda con 30 días de preaviso el día que se sumara el segundo nodo.",
			},
		],
	},
	cookies: {
		id: "cookies",
		label: "Cookies y tecnologías similares",
		version: "2026-08-08",
		effectiveFrom: "2026-09-07",
		href: "/cookies",
		requiresAcceptance: false,
		sourcePath: "presets/help/apps/help/src/pages/CookiesPage.tsx",
		contentHash: "45d0976665f8fe2a5a3c29074357f3885bf46f2152956983074441325b977304",
		corrections: [
			{
				date: "2026-08-09",
				summary:
					"La lista de terceros de §6 se acortó: React y las fotos de Discord dejaron de servirse desde un CDN ajeno, así que el texto declara MENOS terceros de los que declaraba.",
			},
			{
				date: "2026-08-10",
				summary: "Suma uno: el servidor STUN de Google que el túnel P2P del Drive contacta al abrir una transferencia entre dispositivos.",
			},
			{
				date: "2026-08-12",
				summary:
					"§2 declara la cookie técnica `adc_build`, que fija la sesión de navegación a un nodo mientras los artefactos de UI no estén igualados entre nodos (si no, el documento sale de un nodo y sus chunks de otro → 404 intermitentes). Se declara antes de que exista: sólo se escribe con ADC_CLUSTER_GATEWAY=true y algún vecino vivo, y la fila lo dice. Declararla recién el día que se encienda el segundo nodo habría exigido enmienda con 30 días de preaviso, y esa espera bloquearía el despliegue.",
			},
			{
				date: "2026-08-15",
				summary:
					"§5 declara que respetamos Global Privacy Control (sin el script de analítica cuando el navegador manda `Sec-GPC`), y corrige quién inserta ese script: lo inyecta la plataforma, no el proxy de Cloudflare, que es lo que hace posible la decisión por visita.",
			},
			{
				date: "2026-08-20",
				summary:
					"§4.3 declara `adc-generators:*`, el borrador local de los generadores del subdominio `gen` (texto en curso, paleta y preferencias). Se declara antes de que exista, igual que `adc_build`, y la fila deja escrito que no sale del navegador ni lleva identificador de seguimiento — que es lo que hace que el subdominio pueda funcionar sin cuenta y sin consentimiento previo.",
			},
		],
	},
	dpa: {
		id: "dpa",
		label: "Acuerdo de Tratamiento de Datos (DPA)",
		version: "2026-08-08",
		effectiveFrom: "2026-09-07",
		href: "/dpa",
		requiresAcceptance: false,
		sourcePath: "presets/help/apps/help/src/pages/DpaPage.tsx",
		contentHash: "cd64ee99f3eb81476e684ff437fc2c29f5598517470110527ca43f91c54b025d",
		corrections: [
			{
				date: "2026-08-10",
				summary:
					"Se excluye a organizaciones establecidas en el EEE (declaración, garantía e indemnidad); ver el memo de alcance territorial en el repo privado.",
			},
			{
				date: "2026-08-12",
				summary:
					"De cara al plan de escalabilidad: §7 suma redundancia de la infraestructura y copias de seguridad cifradas a las medidas técnicas, y §8 aclara que operar sobre varios servidores propios NO es alta de subencargado (sí lo sería un alojamiento o un backup de terceros, que mantiene el aviso previo y el derecho a terminar el plan).",
			},
		],
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
	/**
	 * Archivo fuente de la página, relativo a la raíz del repo. Única declaración de la ruta: la
	 * usan el generador de PDF, el chequeo de deriva y el panel de administración.
	 */
	sourcePath: string;
	/** SHA-256 de `sourcePath` en esta versión (ver nota de cabecera). */
	contentHash: string;
	/** Correcciones aplicadas a esta versión antes de entrar en vigor, más viejas primero. */
	corrections: readonly LegalCorrection[];
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
 * `true` mientras el documento todavía **no rige** para las cuentas preexistentes.
 *
 * Es la ventana en la que corregir el texto sólo pide actualizar el `contentHash`: versionar
 * pediría re-aceptar algo que nadie aceptó. Fuera de ella, editar el texto obliga a bump con
 * `MIN_LEGAL_NOTICE_DAYS` de preaviso. Lo consultan el panel, el chequeo de deriva y el servicio.
 */
export function isInCorrectionWindow(doc: LegalDocument, now: Date = new Date()): boolean {
	return Date.parse(doc.effectiveFrom) > now.getTime();
}

/** Días que faltan para `effectiveFrom` (0 si ya rige). */
export function daysUntilEffective(doc: LegalDocument, now: Date = new Date()): number {
	const days = Math.ceil((Date.parse(doc.effectiveFrom) - now.getTime()) / 86_400_000);
	return Number.isFinite(days) && days > 0 ? days : 0;
}

/**
 * Fechas que le tocarían a un bump hecho hoy, ya validadas contra el preaviso comprometido.
 * El panel las muestra listas para pegar en este mismo archivo.
 */
export function nextLegalVersionDates(now: Date = new Date()): { version: string; effectiveFrom: string } {
	const iso = (d: Date) => d.toISOString().slice(0, 10);
	const effective = new Date(now.getTime() + MIN_LEGAL_NOTICE_DAYS * 86_400_000);
	return { version: iso(now), effectiveFrom: iso(effective) };
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
