/**
 * Segundo factor (TOTP) de una cuenta.
 *
 * Vive en su **propia colección** y no como campo de `User` a propósito: el documento de usuario
 * lo devuelven una docena de caminos (`/users/me`, el detalle, la búsqueda, los listados admin, el
 * export del titular, las réplicas por organización) y cada uno tendría que acordarse de recortar
 * el secreto. Separarlo hace que no haya nada que recortar.
 */
interface RecoveryCodeRecord {
	/** SHA-256 hex de `userId:codigo` normalizado. El código en claro se muestra una sola vez. */
	hash: string;
	usedAt?: Date;
}

export interface UserTwoFactor {
	userId: string;
	/** Secreto TOTP Base32, sellado at-rest con AAD = `userId`. Nunca sale del servicio. */
	secret: string;
	/** `false` mientras la inscripción no se confirmó con un código válido. */
	enabled: boolean;
	createdAt: Date;
	confirmedAt?: Date;
	/** Último paso TOTP consumido: cierra el replay dentro de la ventana de tolerancia. */
	lastStep?: number;
	recoveryCodes: RecoveryCodeRecord[];
}

/** Vista de `UserTwoFactor` que sí puede viajar por HTTP (sin secreto ni hashes). */
export interface TwoFactorState {
	enabled: boolean;
	/** Hay una inscripción empezada y sin confirmar. */
	pending: boolean;
	confirmedAt?: string;
	recoveryCodesRemaining: number;
	/** La cuenta no puede desactivarlo: es admin de plataforma o de alguna organización. */
	required: boolean;
}

/** Qué factor resolvió una verificación. */
export type TwoFactorMethod = "totp" | "recovery";

/** Cantidad de códigos de recuperación que se emiten por tanda. */
export const RECOVERY_CODE_COUNT = 10;
