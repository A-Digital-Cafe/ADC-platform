/**
 * `metadata` del usuario sin el material de autenticación que vive adentro: el hash del token de
 * arrepentimiento (`deletionCancelTokenHash`) y el del cambio de email pendiente
 * (`emailChangePending.tokenHash`).
 *
 * No son datos personales sino credenciales de un solo uso, así que no salen ni en el export del
 * titular ni en `/users/me` ni —sobre todo— en los listados administrativos, donde serían las de
 * un tercero. El resto de la metadata sí viaja: la UI depende de `bannedAt`, `scheduledDeletionAt`,
 * `deletionReason`, `preferences`, `legalAcceptance`, `createdVia` y de los campos no sensibles de
 * `emailChangePending` (`newEmail`, `requestedAt`, `expiresAt`).
 */
export function sanitizeUserMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
	if (!metadata) return metadata;
	const { deletionCancelTokenHash: _cancelTokenHash, emailChangePending, ...rest } = metadata;
	if (emailChangePending && typeof emailChangePending === "object") {
		const { tokenHash: _tokenHash, ...pending } = emailChangePending as Record<string, unknown>;
		return { ...rest, emailChangePending: pending };
	}
	return rest;
}
