import { Schema, type Model } from "mongoose";
import type { User } from "@common/types/identity/User.ts";
import type { LegalAcceptance } from "@common/utils/legal-docs.ts";
import { hmacSha256Hex } from "@common/utils/crypto.ts";
import type { ILogger } from "../../../../interfaces/utils/ILogger.js";

/**
 * Archivo ANONIMIZADO de constancias de aceptación legal: al purgar una cuenta, la constancia
 * moriría con el usuario y no quedaría prueba del consentimiento para una defensa posterior. Se
 * preserva sin email, username ni IP — el único vínculo es `userRef`, un HMAC del userId que sólo
 * el servidor puede recomputar (seudonimización, no identificación).
 *
 * Retención por defecto 5 años (prescripción genérica art. 2560 CCyC), vía
 * `LEGAL_ACCEPTANCE_RETENTION_DAYS`.
 */
export const LEGAL_ACCEPTANCE_ARCHIVE_DEFAULT_RETENTION_DAYS = 1825;

export interface LegalAcceptanceArchiveRecord {
	/** HMAC-SHA256 del userId con el secreto del servidor: sin el secreto no se revierte. */
	userRef: string;
	archivedAt: Date;
	acceptedAt: Date | null;
	via: string | null;
	termsVersion: string | null;
	privacyVersion: string | null;
	termsHash: string | null;
	privacyHash: string | null;
	ageConfirmed: boolean | null;
	deletionReason: string | null;
}

/**
 * Colección `legal_acceptance_archive` (append-only). Índices vía `syncIndexes()` en el arranque y
 * no por autoIndex: cambiar la retención cambia las opciones del TTL y autoIndex abortaría con
 * IndexOptionsConflict (mismo criterio que `audit_log`).
 */
export function buildLegalAcceptanceArchiveSchema(retentionSeconds: number): Schema<LegalAcceptanceArchiveRecord> {
	const schema = new Schema<LegalAcceptanceArchiveRecord>(
		{
			userRef: { type: String, required: true },
			archivedAt: { type: Date, required: true, default: () => new Date() },
			acceptedAt: { type: Date, default: null },
			via: { type: String, default: null },
			termsVersion: { type: String, default: null },
			privacyVersion: { type: String, default: null },
			termsHash: { type: String, default: null },
			privacyHash: { type: String, default: null },
			ageConfirmed: { type: Boolean, default: null },
			deletionReason: { type: String, default: null },
		},
		{ versionKey: false, autoIndex: false, collection: "legal_acceptance_archive" }
	);

	// Una constancia por cuenta purgada: hace idempotente el upsert cuando el paso final se reintenta.
	schema.index({ userRef: 1 }, { unique: true });
	// Prescripción (art. 2560 CCyC): Mongo borra la constancia pasado el plazo desde `archivedAt`.
	schema.index({ archivedAt: 1 }, { expireAfterSeconds: retentionSeconds });

	return schema;
}

export class LegalAcceptanceArchiver {
	readonly #model: Model<LegalAcceptanceArchiveRecord>;
	readonly #hmacKey: Uint8Array;
	readonly #logger: ILogger;

	constructor(model: Model<LegalAcceptanceArchiveRecord>, hmacKey: Uint8Array, logger: ILogger) {
		this.#model = model;
		this.#hmacKey = hmacKey;
		this.#logger = logger;
	}

	/**
	 * Persiste la constancia anonimizada ANTES del hard delete. Upsert donde la ÚLTIMA constancia
	 * gana: tras una baja cancelada a mitad de cascada la cuenta pudo re-aceptar y volver a pedir
	 * la baja, y los 5 años corren desde el borrado real. Un fallo LANZA — el borrado no procede
	 * sin la constancia archivada.
	 */
	async archiveForUser(user: User): Promise<boolean> {
		const acceptance = (user.metadata?.legalAcceptance ?? null) as Partial<LegalAcceptance> | null;
		if (!acceptance?.termsVersion && !acceptance?.acceptedAt) return false;

		const meta = (user.metadata ?? {}) as Record<string, unknown>;
		const userRef = hmacSha256Hex(user.id, this.#hmacKey);
		await this.#model.updateOne(
			{ userRef },
			{
				$set: {
					userRef,
					archivedAt: new Date(),
					acceptedAt: acceptance.acceptedAt ? new Date(acceptance.acceptedAt) : null,
					via: acceptance.via ?? null,
					termsVersion: acceptance.termsVersion ?? null,
					privacyVersion: acceptance.privacyVersion ?? null,
					termsHash: acceptance.termsHash ?? null,
					privacyHash: acceptance.privacyHash ?? null,
					ageConfirmed: typeof acceptance.ageConfirmed === "boolean" ? acceptance.ageConfirmed : null,
					deletionReason: typeof meta.deletionReason === "string" ? meta.deletionReason : null,
				},
			},
			{ upsert: true }
		);
		this.#logger.logDebug(`Constancia legal archivada (anónima) para purga de cuenta`);
		return true;
	}
}
