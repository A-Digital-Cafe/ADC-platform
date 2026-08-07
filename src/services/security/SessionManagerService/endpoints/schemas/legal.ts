import { Type } from "@sinclair/typebox";

/** Schemas TypeBox de la re-aceptación de documentos legales. */

const PendingLegalDoc = Type.Object({
	id: Type.String(),
	label: Type.String(),
	version: Type.String(),
	effectiveFrom: Type.String({ description: "Fecha desde la que la versión rige para cuentas preexistentes" }),
	href: Type.String({ description: "Ruta del documento dentro de la app `help`" }),
});

export const LegalStatusResponse = Type.Object({
	pending: Type.Array(PendingLegalDoc),
	acceptedAt: Type.Optional(Type.String({ description: "Fecha de la última constancia guardada" })),
	acceptedVersions: Type.Optional(
		Type.Object({
			termsVersion: Type.String(),
			privacyVersion: Type.String(),
		})
	),
});

/**
 * Las versiones que manda el cliente son las que su pantalla mostró; el handler las contrasta con
 * las vigentes y rechaza la aceptación si no coinciden. Sin eso la constancia diría que se aceptó
 * un texto que la persona nunca vio.
 */
export const LegalAcceptBody = Type.Object({
	accepted: Type.Boolean({ description: "Casilla explícita de aceptación (nunca pre-marcada)" }),
	termsVersion: Type.String({ minLength: 1, maxLength: 32 }),
	privacyVersion: Type.String({ minLength: 1, maxLength: 32 }),
	ageConfirmed: Type.Optional(
		Type.Boolean({ description: "Sólo para cuentas sin constancia previa; con constancia se arrastra la declaración del alta" })
	),
});

export const LegalAcceptResponse = Type.Object({
	success: Type.Boolean(),
	acceptedAt: Type.String(),
});
