/**
 * Parseo de duraciones cortas (`"15m"`, `"30s"`, `"7d"`) a segundos.
 *
 * Fuente única para los TTL declarados como string en configs y en la emisión de
 * tokens: el provider JWT firma con estos segundos y el SessionManager calcula
 * con ellos el `expiresAt` que publica al cliente. Si se parsearan por separado,
 * el vencimiento anunciado y el real podrían divergir.
 */

const DURATION_PATTERN = /^(\d+)([smhdw])$/;

const MULTIPLIERS: Record<string, number> = {
	s: 1,
	m: 60,
	h: 60 * 60,
	d: 24 * 60 * 60,
	w: 7 * 24 * 60 * 60,
};

/** Segundos que representa la duración, o `null` si el formato no es válido. */
export function parseDurationSeconds(value: string): number | null {
	const match = DURATION_PATTERN.exec(value);
	if (!match) return null;

	return Number.parseInt(match[1], 10) * MULTIPLIERS[match[2]];
}
