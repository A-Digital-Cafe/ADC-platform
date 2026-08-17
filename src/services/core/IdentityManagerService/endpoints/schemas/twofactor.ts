import { Type } from "@sinclair/typebox";

/** Schemas TypeBox de los endpoints del segundo factor (TOTP). */

export const TwoFactorStateResponse = Type.Object({
	enabled: Type.Boolean(),
	/** Inscripción empezada y sin confirmar. */
	pending: Type.Boolean(),
	confirmedAt: Type.Optional(Type.String()),
	recoveryCodesRemaining: Type.Number(),
	/** La cuenta no puede desactivarlo (admin de plataforma o de alguna organización). */
	required: Type.Boolean(),
});

export const EnrollBody = Type.Object({
	currentPassword: Type.Optional(Type.String({ minLength: 1, maxLength: 256, description: "Obligatoria salvo en cuentas creadas por OAuth" })),
});

export const EnrollResponse = Type.Object({
	/** Secreto Base32. Se sirve UNA vez: después sólo se puede reiniciar la inscripción. */
	secret: Type.String(),
	otpauthUri: Type.String(),
});

export const CodeBody = Type.Object({
	code: Type.String({ minLength: 6, maxLength: 32, description: "Código de 6 dígitos del autenticador" }),
});

export const RecoveryCodesResponse = Type.Object({
	/** Códigos en claro. Se muestran UNA vez y se guardan hasheados. */
	recoveryCodes: Type.Array(Type.String()),
});

export const DisableBody = Type.Object({
	code: Type.String({ minLength: 6, maxLength: 32, description: "Código del autenticador o de recuperación" }),
	currentPassword: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
});


export const AdminResetParams = Type.Object({
	userId: Type.String({ minLength: 1 }),
});

export const AdminResetResponse = Type.Object({
	success: Type.Boolean(),
});
