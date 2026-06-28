import { Type, type Static } from "@sinclair/typebox";
import { compileSchema } from "@common/utils/json-schema.ts";

/**
 * Datos pendientes para vincular una cuenta OAuth con un usuario existente, y su
 * entrada de pending link persistida en Redis. Datos sensibles (provider / email
 * / accessToken) que alimentan el linkeo: el schema valida la forma leída antes
 * de confiar en ella.
 */
const PendingLinkDataSchema = Type.Object({
	provider: Type.String(),
	providerId: Type.String(),
	providerUsername: Type.String(),
	providerAvatar: Type.Optional(Type.String()),
	email: Type.String(),
	accessToken: Type.String(),
});

const PendingLinkEntrySchema = Type.Object({
	data: PendingLinkDataSchema,
	createdAt: Type.Number(),
	expiresAt: Type.Number(),
	attempts: Type.Number(),
});

export const pendingLinkEntryCheck = compileSchema(PendingLinkEntrySchema);

export type PendingLinkData = Static<typeof PendingLinkDataSchema>;
