import type { Model } from "mongoose";
import type { AuditContextValue, AuditEntryInput, AuditLogPage, AuditLogQuery, AuditLogRecord } from "@common/types/security/AuditLog.ts";
import { AuditError } from "@common/types/custom-errors/AuditError.ts";
import { generateId } from "@common/utils/crypto.ts";

/** Límites por página: default razonable + máximo duro innegociable. */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** Topes de saneo: el audit log guarda IDs y contadores, no documentos. */
const MAX_FIELD_LEN = 200;
const MAX_CONTEXT_KEYS = 20;
const MAX_CONTEXT_STRING_LEN = 200;

/**
 * Tripwires anti-PII del `context` (minimización, Ley 25.326/RGPD): un email o una IP completa no
 * es un ID. Un falso positivo sólo degrada a menos contexto; nunca bloquea la operación auditada.
 */
const LOOKS_LIKE_EMAIL = /@/;
const LOOKS_LIKE_IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

function clampLimit(n: number | undefined): number {
	if (n === undefined || !Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
	return Math.min(Math.floor(n), MAX_LIMIT);
}

function cleanShortString(value: string | undefined): string | undefined {
	const v = value?.trim();
	return v ? v.slice(0, MAX_FIELD_LEN) : undefined;
}

/** Solo primitivos planos; strings acotados y sin pinta de email/IP. Lo demás se descarta. */
function sanitizeContext(context: Record<string, AuditContextValue> | undefined): Record<string, AuditContextValue> | undefined {
	if (!context) return undefined;
	const out: Record<string, AuditContextValue> = {};
	let keys = 0;
	for (const [rawKey, value] of Object.entries(context)) {
		if (keys >= MAX_CONTEXT_KEYS) break;
		const key = rawKey.trim().slice(0, MAX_FIELD_LEN);
		if (!key) continue;
		if (value === null || typeof value === "boolean") {
			out[key] = value;
		} else if (typeof value === "number") {
			if (!Number.isFinite(value)) continue;
			out[key] = value;
		} else if (typeof value === "string") {
			const v = value.slice(0, MAX_CONTEXT_STRING_LEN);
			if (LOOKS_LIKE_EMAIL.test(v) || LOOKS_LIKE_IPV4.test(v)) continue;
			out[key] = v;
		} else {
			continue; // objetos/arrays anidados: nunca
		}
		keys++;
	}
	return keys > 0 ? out : undefined;
}

/** Persistencia APPEND-ONLY: sin update ni delete; las entradas sólo salen por el TTL sobre `at`. */
export class AuditLogRepository {
	readonly #model: Model<AuditLogRecord>;

	constructor(model: Model<AuditLogRecord>) {
		this.#model = model;
	}

	/** Inserta una entrada ya atribuida a su `origin`. Lanza si el insert falla (el caller decide fail-open/closed). */
	async append(origin: string, entry: AuditEntryInput): Promise<void> {
		const action = cleanShortString(entry.action);
		const actorUserId = cleanShortString(entry.actorUserId);
		if (!action || !actorUserId) {
			throw new AuditError(400, "INVALID_ENTRY", "`action` y `actorUserId` son requeridos");
		}
		const actorRoles = entry.actorRoles?.map((r) => r.trim().slice(0, MAX_FIELD_LEN)).filter(Boolean);
		await this.#model.create({
			id: generateId(),
			at: new Date(),
			origin: origin.slice(0, MAX_FIELD_LEN),
			action,
			actorUserId,
			actorRoles: actorRoles?.length ? actorRoles : undefined,
			targetUserId: cleanShortString(entry.targetUserId),
			targetResource: cleanShortString(entry.targetResource),
			context: sanitizeContext(entry.context),
		});
	}

	/**
	 * Página de entradas de la más nueva a la más vieja. Cursor por (`at`, `id`):
	 * estable ante timestamps repetidos y no degrada con offsets grandes.
	 */
	async getPage(opts: AuditLogQuery): Promise<AuditLogPage> {
		const limit = clampLimit(opts.limit);
		const filter: Record<string, unknown> = {};
		if (opts.action) filter.action = opts.action;
		if (opts.actorUserId) filter.actorUserId = opts.actorUserId;
		if (opts.targetUserId) filter.targetUserId = opts.targetUserId;
		if (opts.cursor) {
			filter.$or = [{ at: { $lt: opts.cursor.at } }, { at: opts.cursor.at, id: { $lt: opts.cursor.id } }];
		}
		// Una fila extra solo para saber si existe página siguiente.
		const docs = await this.#model
			.find(filter)
			.sort({ at: -1, id: -1 })
			.limit(limit + 1)
			.lean<AuditLogRecord[]>();
		const items = docs.slice(0, limit);
		const last = items.at(-1);
		return { items, nextCursor: docs.length > limit && last ? { at: last.at, id: last.id } : null };
	}
}
