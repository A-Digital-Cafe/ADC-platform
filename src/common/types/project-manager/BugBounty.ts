/**
 * Modelo del Bug Bounty Program de ADC Platform.
 *
 * Flujo: el reporter abre un ticket tipo `security` en el subdominio `status`.
 * Se calcula un `descriptionHash` (SHA-256 de la descripción) que se publica de
 * inmediato en el log de transparencia. La descripción en sí queda privada hasta
 * que el ticket esté resuelto Y el reporter haya consentido divulgarla
 * (`publicDisclosure`); recién ahí se publica y debe coincidir con el hash. El
 * crédito con handle es un consentimiento aparte (`wantsCredit`): se puede pedir
 * la publicación del reporte sin querer aparecer nombrado, y viceversa.
 * La recompensa es un upgrade temporal de tier (plus/pro) — ver [[tiers]].
 *
 * El admin/Security Manager triagea la severidad y otorga la recompensa
 * (variante plus/pro) considerando la preferencia del reporter y los recursos
 * disponibles; los valores de `BUG_BOUNTY_POLICY` son MÍNIMOS garantizados y
 * pueden incrementarse o negociarse desde el propio ticket.
 */

import type { AccountTier } from "../tiers.ts";

/** @public Severidad (alineada a CVSS) que asigna el triage del admin. */
export type BugBountySeverity = "low" | "medium" | "high" | "critical";

/** @public */
export const BUG_BOUNTY_SEVERITIES: readonly BugBountySeverity[] = ["low", "medium", "high", "critical"] as const;

/** Una variante de recompensa: tier de pago durante N días. */
interface BugBountyReward {
	/**
	 * Sólo tiers **de pago**: la recompensa es un plan que se regala por un tiempo.
	 * `vip` queda afuera aunque sea un tier superior a `free` — se otorga por
	 * pertenencia a la comunidad y no vence, así que no es algo que se pueda dar
	 * "por 10 días" ni tiene sentido como premio.
	 */
	tier: Exclude<AccountTier, "free" | "vip">;
	/** Duración del upgrade en días (mínimo garantizado; el admin puede ampliar). */
	days: number;
}

/**
 * Recompensas MÍNIMAS por severidad. Cada severidad puede ofrecer varias
 * variantes (plus de mayor duración o pro de menor duración); el admin elige
 * una considerando la preferencia del reporter (`rewardPreference`).
 *
 * Bandas acordadas:
 * - low      → 1-10 días plus  (títulos, formato del sitio, lógicas simples)
 * - medium   → 1 mes plus / 1-10 días pro
 * - high     → 1 mes plus / 1-10 días pro  (lógica de negocio que afecta a muchos
 *              usuarios o CVEs conocidos en librerías de la plataforma)
 * - critical → 3 meses plus / 1 mes pro    (errores de seguridad críticos)
 * @public
 */
export const BUG_BOUNTY_POLICY: Record<BugBountySeverity, readonly BugBountyReward[]> = {
	low: [{ tier: "plus", days: 10 }],
	medium: [
		{ tier: "plus", days: 30 },
		{ tier: "pro", days: 10 },
	],
	high: [
		{ tier: "plus", days: 30 },
		{ tier: "pro", days: 10 },
	],
	critical: [
		{ tier: "plus", days: 90 },
		{ tier: "pro", days: 30 },
	],
} as const;

/** @public Preferencia de recompensa que expresa el reporter (el admin la considera). */
export type RewardPreference = "plus" | "pro";

/**
 * Estado normalizado, derivado de la columna del project manager.
 *
 * `duplicate` existe aparte de `rejected` por una razón de equidad: un reporte
 * duplicado **es válido**, sólo que alguien lo mandó antes. Meterlo en la misma
 * bolsa que un reporte inválido o spam —que es lo que hacía este tipo cuando
 * sólo tenía `rejected`— publica en un log abierto que quien acertó, pero
 * segundo, reportó cualquier cosa.
 */
type BugBountyPublicStatus = "received" | "triaging" | "in_progress" | "resolved" | "duplicate" | "rejected";

/**
 * Estado público por **clave canónica** de columna del tablero de tickets.
 * Es la fuente de verdad: las columnas que el servicio reconcilia
 * (ver `TICKETS_BOARD_COLUMNS`) tienen estas keys estables.
 */
const BUG_BOUNTY_COLUMN_STATUS: Record<string, BugBountyPublicStatus> = {
	security: "received",
	triaging: "triaging",
	in_progress: "in_progress",
	done: "resolved",
	duplicate: "duplicate",
	rejected: "rejected",
};

/**
 * Deriva el estado público de un reporte a partir de la columna en la que está.
 * Primero usa el mapa explícito por `columnKey` (canónico); si la columna es
 * custom (un admin la agregó a mano), cae a una heurística por nombre.
 * Fallback final: `triaging`.
 * @public
 */
export function deriveBugBountyStatus(columnKey: string | undefined, columnName?: string): BugBountyPublicStatus {
	const key = (columnKey ?? "").toLowerCase();
	if (key in BUG_BOUNTY_COLUMN_STATUS) return BUG_BOUNTY_COLUMN_STATUS[key];
	const c = (columnName ?? columnKey ?? "").toLowerCase();
	// El duplicado se evalúa ANTES que el descarte: una columna llamada
	// "Duplicados / descartados" tiene que caer del lado que no acusa a nadie.
	if (/(duplicad|duplicate|dupe)/.test(c)) return "duplicate";
	if (/(resolv|resuelt|solucion|done|fixed|closed|cerrad|hecho)/.test(c)) return "resolved";
	if (/(reject|rechaz|descart|declin|wontfix|invalid|spam)/.test(c)) return "rejected";
	if (/(progress|progres|proceso|doing|review|revis|fixing|wip)/.test(c)) return "in_progress";
	if (/(triag|backlog|new|nuevo|pending|pendiente|recib)/.test(c)) return "received";
	return "triaging";
}

/** @public Una entrada del log público de transparencia. */
export interface BugBountyPublicEntry {
	/** Clave pública del ticket (ej. `STATUS-123`). */
	ticketKey: string;
	/** Fecha/hora pública de recepción (ISO-8601). */
	reportedAt: string;
	/** SHA-256 (hex) de la descripción original. */
	descriptionHash: string;
	/** Estado derivado de la columna del PM. */
	status: BugBountyPublicStatus;
	/**
	 * Clave pública del reporte original del que éste es duplicado (ej. `STATUS-42`).
	 * Sólo tiene sentido con `status: "duplicate"`; es lo que convierte un
	 * "descartado" opaco en un "ya lo habían reportado, y acá está cuál".
	 */
	duplicateOf?: string | null;
	/** Severidad asignada en triage (si ya se asignó). */
	severity?: BugBountySeverity | null;
	/** Handle de crédito, solo si el reporter aceptó agradecimiento público. */
	creditHandle?: string | null;
	/**
	 * Descripción original: presente SOLO cuando el ticket está `resolved` y el
	 * reporter consintió la divulgación (`publicDisclosure`), que es un
	 * consentimiento distinto del crédito. Debe verificar contra `descriptionHash`.
	 */
	description?: string | null;
}
