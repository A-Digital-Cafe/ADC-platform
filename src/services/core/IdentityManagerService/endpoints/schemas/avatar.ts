import { Type } from "@sinclair/typebox";

// ── Params ───────────────────────────────────────────────────────────────

export const AvatarAttachmentParams = Type.Object({
	attachmentId: Type.String({ minLength: 1, description: "ID del adjunto subido" }),
});

export const AvatarUserParams = Type.Object({
	userId: Type.String({ minLength: 1, description: "ID del usuario" }),
});

// ── Body ─────────────────────────────────────────────────────────────────

export const PresignAvatarBody = Type.Object({
	fileName: Type.String({ minLength: 1 }),
	mimeType: Type.String({ minLength: 1, description: "MIME del archivo (ej. image/png)" }),
	size: Type.Integer({ minimum: 1, description: "Tamaño del archivo en bytes" }),
});

export const SelectAvatarBody = Type.Object({
	source: Type.String({ description: "default | custom | none | linked:<provider>" }),
});

// ── Responses ──────────────────────────────────────────────────────────────

const AvatarOption = Type.Object({
	id: Type.String({ description: "default | custom | none | linked:<provider>" }),
	label: Type.String(),
	url: Type.Optional(Type.String()),
	provider: Type.Optional(Type.String()),
});

export const AvatarOptionsResponse = Type.Object({
	options: Type.Array(AvatarOption),
	selected: Type.String(),
});

export const AvatarSourceResponse = Type.Object({
	avatarSource: Type.String(),
});
