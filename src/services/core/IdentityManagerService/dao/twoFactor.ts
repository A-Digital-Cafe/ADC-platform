import type { Model } from "mongoose";
import type { ILogger } from "../../../../interfaces/utils/ILogger.js";
import { RECOVERY_CODE_COUNT, type TwoFactorMethod, type TwoFactorState, type UserTwoFactor } from "@common/types/identity/TwoFactor.ts";
import { createAtRestSealer } from "@common/utils/at-rest-envelope.ts";
import { sha256Hex, safeEqualHex } from "@common/utils/crypto.ts";
import {
	buildOtpauthUri,
	generateRecoveryCodes,
	generateTotpSecret,
	normalizeRecoveryCode,
	totpStep,
	verifyTotpCode,
} from "@common/utils/totp.ts";
import { IdentityError } from "@common/types/custom-errors/IdentityError.ts";

/**
 * El secreto TOTP equivale a la contraseña del segundo factor: quien lo lee genera códigos para
 * siempre. Va cifrado con su propia sub-clave y atado al `userId` por AAD, así que moverlo de fila
 * lo vuelve ilegible.
 */
const secretSeal = createAtRestSealer("adc:totp-secret");

export interface EnrollmentStart {
	/** Secreto en claro: se muestra UNA vez (QR + transcripción manual) y no se vuelve a servir. */
	secret: string;
	otpauthUri: string;
}

/**
 * Alta, verificación y baja del segundo factor. Sin chequeos de permiso: es una primitiva
 * pre-sesión (el login la usa con el usuario a medio autenticar), así que sólo se alcanza por la
 * superficie `_internal` y por los endpoints propios, que acotan a la cuenta del llamante.
 */
export class TwoFactorManager {
	readonly #model: Model<UserTwoFactor>;
	readonly #logger: ILogger;
	readonly #issuer: string;

	constructor(model: Model<UserTwoFactor>, logger: ILogger, issuer: string) {
		this.#model = model;
		this.#logger = logger;
		this.#issuer = issuer;
	}

	async #getRecord(userId: string): Promise<UserTwoFactor | null> {
		const doc = await this.#model.findOne({ userId });
		return (doc?.toObject?.() || doc) as UserTwoFactor | null;
	}

	/** Sólo cuenta las inscripciones CONFIRMADAS: una a medio hacer no bloquea ningún login. */
	async isEnabled(userId: string): Promise<boolean> {
		const record = await this.#getRecord(userId);
		return Boolean(record?.enabled);
	}

	async getState(userId: string, required: boolean): Promise<TwoFactorState> {
		const record = await this.#getRecord(userId);
		return {
			enabled: Boolean(record?.enabled),
			pending: Boolean(record) && !record!.enabled,
			confirmedAt: record?.confirmedAt ? new Date(record.confirmedAt).toISOString() : undefined,
			recoveryCodesRemaining: (record?.recoveryCodes || []).filter((code) => !code.usedAt).length,
			required,
		};
	}

	/**
	 * Empieza (o reinicia) la inscripción y devuelve el secreto nuevo.
	 *
	 * Reiniciar pisa el secreto pendiente anterior a propósito: si alguien abandonó el alta a mitad
	 * de camino, el QR viejo ya no vale. Con el 2FA **ya activo** no se reinicia nada: primero hay
	 * que desactivarlo, que exige el factor vigente.
	 */
	async startEnrollment(userId: string, accountLabel: string): Promise<EnrollmentStart> {
		const existing = await this.#getRecord(userId);
		if (existing?.enabled) {
			throw new IdentityError(409, "TWO_FACTOR_ALREADY_ENABLED", "La verificación en dos pasos ya está activa");
		}

		const secret = generateTotpSecret();
		await this.#model.findOneAndUpdate(
			{ userId },
			{
				$set: {
					secret: secretSeal.seal(secret, this.#logger, userId),
					enabled: false,
					createdAt: new Date(),
					recoveryCodes: [],
				},
				$unset: { confirmedAt: "", lastStep: "" },
			},
			{ upsert: true }
		);

		return { secret, otpauthUri: buildOtpauthUri({ secret, account: accountLabel, issuer: this.#issuer }) };
	}

	/**
	 * Confirma la inscripción con un código del autenticador y devuelve los códigos de recuperación
	 * en claro (única vez que existen fuera del dispositivo de quien los pidió).
	 */
	async confirmEnrollment(userId: string, code: string): Promise<string[]> {
		const record = await this.#getRecord(userId);
		if (!record) throw new IdentityError(409, "NO_PENDING_ENROLLMENT", "No hay una inscripción pendiente");
		if (record.enabled) throw new IdentityError(409, "TWO_FACTOR_ALREADY_ENABLED", "La verificación en dos pasos ya está activa");

		const secret = this.#openSecret(record);
		const step = verifyTotpCode(secret, code);
		if (step === null) throw new IdentityError(400, "INVALID_TOTP", "El código no es válido");

		const { codes, records } = this.#buildRecoveryCodes(userId);
		await this.#model.updateOne(
			{ userId },
			{ $set: { enabled: true, confirmedAt: new Date(), lastStep: step, recoveryCodes: records } }
		);

		this.#logger.logInfo(`2FA activado para el usuario ${userId}`);
		return codes;
	}

	/**
	 * Verifica un código del autenticador o uno de recuperación. Devuelve qué factor resolvió, o
	 * `null`. Consume: el paso TOTP queda marcado y el código de recuperación usado no vuelve.
	 */
	async verify(userId: string, code: string): Promise<TwoFactorMethod | null> {
		const record = await this.#getRecord(userId);
		if (!record?.enabled) return null;

		const step = verifyTotpCode(this.#openSecret(record), code, { lastStep: record.lastStep });
		if (step !== null) {
			// Condicionado a `lastStep`: dos peticiones con el MISMO código en paralelo compiten por
			// el update y sólo una lo gana, así que la ventana de replay no se abre por concurrencia.
			const consumed = await this.#model.updateOne(
				{ userId, $or: [{ lastStep: { $exists: false } }, { lastStep: { $lt: step } }] },
				{ $set: { lastStep: step } }
			);
			return consumed.modifiedCount > 0 ? "totp" : null;
		}

		return this.#consumeRecoveryCode(userId, record, code);
	}

	/** Baja del segundo factor: borra el registro entero (secreto y códigos incluidos). */
	async disable(userId: string): Promise<void> {
		await this.#model.deleteOne({ userId });
		this.#logger.logInfo(`2FA desactivado para el usuario ${userId}`);
	}

	/** Emite una tanda nueva de códigos de recuperación e invalida la anterior. */
	async regenerateRecoveryCodes(userId: string): Promise<string[]> {
		const record = await this.#getRecord(userId);
		if (!record?.enabled) throw new IdentityError(409, "TWO_FACTOR_NOT_ENABLED", "La verificación en dos pasos no está activa");

		const { codes, records } = this.#buildRecoveryCodes(userId);
		await this.#model.updateOne({ userId }, { $set: { recoveryCodes: records } });
		return codes;
	}

	#buildRecoveryCodes(userId: string): { codes: string[]; records: UserTwoFactor["recoveryCodes"] } {
		const codes = generateRecoveryCodes(RECOVERY_CODE_COUNT);
		return { codes, records: codes.map((code) => ({ hash: TwoFactorManager.hashRecoveryCode(userId, code) })) };
	}

	async #consumeRecoveryCode(userId: string, record: UserTwoFactor, code: string): Promise<TwoFactorMethod | null> {
		const normalized = normalizeRecoveryCode(code);
		if (!normalized) return null;

		const candidate = TwoFactorManager.hashRecoveryCode(userId, normalized);
		const index = (record.recoveryCodes || []).findIndex((entry) => !entry.usedAt && safeEqualHex(entry.hash, candidate));
		if (index < 0) return null;

		// Filtro por `usedAt: null` sobre esa posición: si dos peticiones traen el mismo código,
		// la segunda no modifica nada y se rechaza.
		const consumed = await this.#model.updateOne(
			{ userId, [`recoveryCodes.${index}.usedAt`]: { $exists: false } },
			{ $set: { [`recoveryCodes.${index}.usedAt`]: new Date(), lastStep: totpStep() } }
		);
		if (consumed.modifiedCount === 0) return null;

		this.#logger.logWarn(`El usuario ${userId} entró con un código de recuperación 2FA`);
		return "recovery";
	}

	#openSecret(record: UserTwoFactor): string {
		const secret = secretSeal.open(record.secret, this.#logger, record.userId);
		if (!secret) {
			// Sin secreto legible no hay forma de validar nada. Fallar cerrado y a la vista: dejarlo
			// pasar convertiría un problema de claves en un bypass del segundo factor.
			throw new IdentityError(500, "TWO_FACTOR_UNREADABLE", "No se pudo leer el segundo factor de la cuenta");
		}
		return secret;
	}

	/** El `userId` entra en el hash para que una misma tanda no valga en otra cuenta. */
	private static hashRecoveryCode(userId: string, code: string): string {
		return sha256Hex(`${userId}:${normalizeRecoveryCode(code)}`);
	}
}
