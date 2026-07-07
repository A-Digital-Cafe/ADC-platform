import { ModerationError } from "@common/types/custom-errors/ModerationError.ts";

export interface BanRequestInput {
	reason?: string;
	expiresAt?: string | Date | null;
}

export interface ParsedBanRequest {
	reason: string;
	/** null = permaban. Fechas inválidas también se tratan como permaban (no se rechaza la petición). */
	expiresAt: Date | null;
}

/**
 * Valida `reason` y normaliza `expiresAt`.
 * - `reason` requerido, mínimo 3 caracteres (tras trim) → `INVALID_REASON`.
 * - `expiresAt` opcional: null/undefined/fecha inválida → permaban (null).
 */
export function parseBanRequest(body: BanRequestInput | undefined): ParsedBanRequest {
	const rawReason = body?.reason?.trim();
	if (!rawReason || rawReason.length < 3) {
		throw new ModerationError(400, "INVALID_REASON", "Reason requerido (mín. 3 chars)");
	}

	const raw = body?.expiresAt;
	let expiresAt: Date | null = null;
	if (raw) {
		const d = raw instanceof Date ? raw : new Date(raw);
		if (!Number.isNaN(d.getTime())) expiresAt = d;
	}

	return { reason: rawReason, expiresAt };
}
