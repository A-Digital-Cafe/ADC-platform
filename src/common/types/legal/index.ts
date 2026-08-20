/**
 * Contratos de la tab «Legales» del panel de administración, entre `LegalDocsService` y
 * `adc-admin-panel`.
 *
 * Todo lo que describen estos tipos es **el estado del nodo que responde**, no el de un registro
 * central: el texto legal viaja en el código y el PDF congelado vive en el volumen de cada
 * despliegue (`public/legal/` está gitignored). Que dev y producción difieran es lo esperable, y
 * poder verlo es justamente el punto de la pantalla.
 */

import type { LegalCorrection } from "../../utils/legal-docs.ts";

/**
 * @public Momento del ciclo de vida en que está una versión.
 *
 * - `en-preaviso`: publicada pero todavía sin regir para las cuentas preexistentes. Corregir el
 *   texto sólo pide actualizar el `contentHash`.
 * - `vigente`: ya rige. Editar el texto obliga a versionar con el preaviso comprometido.
 */
export type LegalDocState = "en-preaviso" | "vigente";

/** @public El PDF congelado de una versión, tal como está en ESTE nodo. */
export interface LegalPdfInfo {
	file: string;
	bytes: number;
	/** ISO 8601 — `mtime` del archivo: cuándo lo generó este nodo. */
	generatedAt: string;
	/** Ruta pública servida por la app `help`. */
	href: string;
}

/** @public Un documento legal con todo lo que el panel necesita para decidir si hay algo que hacer. */
export interface LegalDocOverview {
	id: string;
	label: string;
	href: string;
	version: string;
	effectiveFrom: string;
	requiresAcceptance: boolean;
	sourcePath: string;
	state: LegalDocState;
	/** Días que faltan para `effectiveFrom` (0 si ya rige). */
	daysUntilEffective: number;
	/** Días de preaviso reales de esta versión (`version` → `effectiveFrom`). */
	noticeDays: number;
	/** `false` = el preaviso quedó por debajo del comprometido en los Términos. */
	noticeOk: boolean;
	/** El hash declarado en `legal-docs.ts`. */
	sealedHash: string;
	/** El del archivo desplegado; `null` si no se pudo leer (fuente ausente en este nodo). */
	deployedHash: string | null;
	/** `true` = el texto desplegado ya no es el que la versión sella. */
	drifted: boolean;
	corrections: readonly LegalCorrection[];
	pdf: LegalPdfInfo | null;
}

/**
 * @public Cifras de aceptación de la versión vigente.
 *
 * Son un `$group` sobre las cuentas activas: el panel nunca lista personas. `pendingSeen` es la
 * señal que hoy no existe en ningún lado — cuentas que entraron después de que la versión rigiera,
 * o sea que vieron el gate de re-aceptación, y aun así no aceptaron.
 */
export interface LegalAdoption {
	/** Cuentas activas consideradas (excluye las que están en baja). */
	total: number;
	accepted: number;
	pending: number;
	pendingSeen: number;
	pendingDormant: number;
	/** Cuentas con baja programada: quedan fuera de `total` para no ensuciar el porcentaje. */
	deleting: number;
	/** ISO 8601 — el agregado se cachea, así que puede no ser de este instante. */
	computedAt: string;
	termsVersion: string;
	privacyVersion: string;
	/**
	 * Desde cuándo se exige esta versión (la más tardía de los dos documentos que se aceptan).
	 * Si todavía no llegó, `pending` es lo normal y no hay nada que hacer: nadie vio el gate.
	 */
	enforcedFrom: string;
}

/** @public Respuesta de `GET /api/legal/admin/overview`. */
export interface LegalOverview {
	docs: LegalDocOverview[];
	/** `null` si el servicio de identidad no respondió: el resto de la pantalla sirve igual. */
	adoption: LegalAdoption | null;
	/** Fechas que le tocarían a un bump hecho hoy, listas para pegar en `legal-docs.ts`. */
	nextVersion: { version: string; effectiveFrom: string };
	nodeId: string;
}

/**
 * @public Qué produjo una entrada del historial.
 *
 * - `pdf`: generación de los PDF faltantes (la del arranque incluida).
 * - `announce`: aviso de cambio de versión a todas las cuentas.
 * - `rebuild`: regeneración forzada de un PDF ya congelado. Destructiva.
 */
export type LegalRunKind = "pdf" | "announce" | "rebuild";

/** @public Entrada del historial de ejecuciones. */
export interface LegalRun {
	id: string;
	kind: LegalRunKind;
	/** ISO 8601. */
	at: string;
	nodeId: string;
	/** `null` = lo disparó el arranque del servicio, no una persona. */
	actorUserId: string | null;
	ok: boolean;
	/** Una línea legible: es lo que se lee en la tabla. */
	summary: string;
	docIds: string[];
}

/** @public Respuesta de `GET /api/legal/admin/runs`. */
export interface LegalRunsPage {
	items: LegalRun[];
	/** `at` de la última entrada devuelta; `null` si no hay más. */
	nextCursor: string | null;
}

/** @public Motivo mínimo exigido para regenerar un PDF congelado. */
export const LEGAL_REBUILD_MIN_REASON = 12;

/** @public Cuánto se cachea el agregado de aceptación. Contar cuentas no puede correr por request. */
export const LEGAL_ADOPTION_CACHE_SECONDS = 300;
