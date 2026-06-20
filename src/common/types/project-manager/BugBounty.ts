/**
 * Modelo del Bug Bounty Program de ADC Platform.
 *
 * Flujo: el reporter abre un ticket tipo `security` en el subdominio `status`.
 * Se calcula un `descriptionHash` (SHA-256 de la descripción) que se publica de
 * inmediato en el log de transparencia. Al resolverse, si el reporter aceptó
 * agradecimiento público, la descripción se hace pública y debe coincidir con el
 * hash. La recompensa es un upgrade temporal de tier (plus/pro) — ver [[tiers]].
 *
 * El admin/Security Manager triagea la severidad y otorga la recompensa
 * (variante plus/pro) considerando la preferencia del reporter y los recursos
 * disponibles; los valores de `BUG_BOUNTY_POLICY` son MÍNIMOS garantizados y
 * pueden incrementarse o negociarse desde el propio ticket.
 */

import type { AccountTier } from "../tiers.ts";

/** Severidad (alineada a CVSS) que asigna el triage del admin. */
export type BugBountySeverity = "low" | "medium" | "high" | "critical";

export const BUG_BOUNTY_SEVERITIES: readonly BugBountySeverity[] = ["low", "medium", "high", "critical"] as const;

/** Una variante de recompensa: tier de pago durante N días. */
export interface BugBountyReward {
	tier: Exclude<AccountTier, "free">;
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

/** Preferencia de recompensa que expresa el reporter (el admin la considera). */
export type RewardPreference = "plus" | "pro";

/** Estado normalizado, derivado de la columna del project manager. */
export type BugBountyPublicStatus = "received" | "triaging" | "in_progress" | "resolved" | "rejected";

/**
 * Estado público por **clave canónica** de columna del tablero de tickets.
 * Es la fuente de verdad: las columnas que el servicio reconcilia
 * (ver `TICKETS_BOARD_COLUMNS`) tienen estas keys estables.
 */
export const BUG_BOUNTY_COLUMN_STATUS: Record<string, BugBountyPublicStatus> = {
	security: "received",
	triaging: "triaging",
	in_progress: "in_progress",
	done: "resolved",
	rejected: "rejected",
};

/**
 * Deriva el estado público de un reporte a partir de la columna en la que está.
 * Primero usa el mapa explícito por `columnKey` (canónico); si la columna es
 * custom (un admin la agregó a mano), cae a una heurística por nombre.
 * Fallback final: `triaging`.
 */
export function deriveBugBountyStatus(columnKey: string | undefined, columnName?: string): BugBountyPublicStatus {
	const key = (columnKey ?? "").toLowerCase();
	if (key in BUG_BOUNTY_COLUMN_STATUS) return BUG_BOUNTY_COLUMN_STATUS[key];
	const c = (columnName ?? columnKey ?? "").toLowerCase();
	if (/(resolv|resuelt|solucion|done|fixed|closed|cerrad|hecho)/.test(c)) return "resolved";
	if (/(reject|rechaz|descart|declin|wontfix|invalid|duplicad|spam)/.test(c)) return "rejected";
	if (/(progress|progres|proceso|doing|review|revis|fixing|wip)/.test(c)) return "in_progress";
	if (/(triag|backlog|new|nuevo|pending|pendiente|recib)/.test(c)) return "received";
	return "triaging";
}

/** Una entrada del log público de transparencia. */
export interface BugBountyPublicEntry {
	/** Clave pública del ticket (ej. `STATUS-123`). */
	ticketKey: string;
	/** Fecha/hora pública de recepción (ISO-8601). */
	reportedAt: string;
	/** SHA-256 (hex) de la descripción original. */
	descriptionHash: string;
	/** Estado derivado de la columna del PM. */
	status: BugBountyPublicStatus;
	/** Severidad asignada en triage (si ya se asignó). */
	severity?: BugBountySeverity | null;
	/** Handle de crédito, solo si el reporter aceptó agradecimiento público. */
	creditHandle?: string | null;
	/**
	 * Descripción original: presente SOLO cuando el ticket está `resolved` y el
	 * reporter aceptó agradecimiento público. Debe verificar contra `descriptionHash`.
	 */
	description?: string | null;
}
