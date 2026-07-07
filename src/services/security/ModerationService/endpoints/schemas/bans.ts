import { Type } from "@sinclair/typebox";

/** Schemas TypeBox para los endpoints de moderación (bans) de ModerationService. */

// ── Query ────────────────────────────────────────────────────────────────

export const ListBansQuery = Type.Object({
	activeOnly: Type.Optional(Type.String({ description: '"false" para incluir bans inactivos (por defecto solo activos)' })),
	limit: Type.Optional(Type.String({ description: "Máximo de resultados (máx. 500, por defecto 200)" })),
});

// ── Body ─────────────────────────────────────────────────────────────────

export const CreateBanBody = Type.Object(
	{
		userId: Type.Optional(Type.String()),
		emails: Type.Optional(Type.Array(Type.String())),
		ips: Type.Optional(Type.Array(Type.String())),
		reason: Type.Optional(Type.String()),
		expiresAt: Type.Optional(Type.Union([Type.String({ format: "date-time" }), Type.Null()])),
	},
	{ description: "Provee `userId` (ban completo) o `emails`/`ips` (ban raw)" }
);

export const UnbanBody = Type.Object(
	{
		userId: Type.Optional(Type.String()),
		source: Type.Optional(Type.String()),
		externalId: Type.Optional(Type.String()),
		reason: Type.Optional(Type.String()),
	},
	{ description: "Provee `userId` o (`source` + `externalId`)" }
);

// ── Responses ──────────────────────────────────────────────────────────────

const BanRecord = Type.Object({
	id: Type.String(),
	userId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	reason: Type.Optional(Type.String()),
	source: Type.Optional(Type.String()),
	externalId: Type.Optional(Type.String()),
	bannedAt: Type.String({ format: "date-time" }),
	expiresAt: Type.Optional(Type.Union([Type.String({ format: "date-time" }), Type.Null()])),
	active: Type.Boolean(),
	unbannedAt: Type.Optional(Type.Union([Type.String({ format: "date-time" }), Type.Null()])),
	unbanReason: Type.Optional(Type.String()),
	emailHashCount: Type.Integer(),
	ipHashCount: Type.Integer(),
	emailMasks: Type.Array(Type.String({ description: "Email enmascarado (`gp***@g***.com`), no reversible" })),
	emailHashPrefixes: Type.Array(Type.String({ description: "Prefijo (12 hex) del hash de email, para correlación visual" })),
	ipHashPrefixes: Type.Array(Type.String({ description: "Prefijo (12 hex) del hash de IP, para correlación visual" })),
});

export const ListBansResponse = Type.Object({ bans: Type.Array(BanRecord) });
export const CreateBanResponse = Type.Object({ ok: Type.Boolean(), id: Type.String() });
export const UnbanResponse = Type.Object({ ok: Type.Boolean(), removed: Type.Integer() });
