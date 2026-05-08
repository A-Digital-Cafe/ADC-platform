const DEFAULT_BODY_LIMIT_BYTES = 1_048_576;
const MAX_BODY_LIMIT_BYTES = 25 * 1_048_576;

export function getBodyLimitBytes(): number {
	const raw = process.env.HTTP_BODY_LIMIT_BYTES || process.env.ADC_HTTP_BODY_LIMIT_BYTES;
	if (!raw) return DEFAULT_BODY_LIMIT_BYTES;

	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_BODY_LIMIT_BYTES;
	return Math.min(Math.floor(parsed), MAX_BODY_LIMIT_BYTES);
}
