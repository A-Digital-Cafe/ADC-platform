import { Type } from "@sinclair/typebox";

/**
 * Schemas TypeBox de StorageQuotaService: validación de entrada y doc OpenAPI.
 */

export const OkResponse = Type.Object({ ok: Type.Boolean() });

const AppUsage = Type.Object({
	bytes: Type.Integer({ minimum: 0 }),
	count: Type.Integer({ minimum: 0 }),
});

export const UsageSnapshotResponse = Type.Object({
	userId: Type.String(),
	orgId: Type.Union([Type.String(), Type.Null()], { description: "Contexto del snapshot: null = personal, string = organización" }),
	totalBytes: Type.Integer({ minimum: 0 }),
	totalCount: Type.Integer({ minimum: 0 }),
	apps: Type.Record(Type.String(), AppUsage),
	effectiveLimit: Type.Integer({ description: "-1 = sin límite" }),
	updatedAt: Type.Optional(Type.String({ format: "date-time" })),
});

export const AppsResponse = Type.Object({
	apps: Type.Array(
		Type.Object({
			appId: Type.String(),
			label: Type.String(),
			minBytes: Type.Integer({ minimum: 0, description: "Bytes garantizados a la app en el contexto del caller aunque la cuota esté agotada" }),
		})
	),
	context: Type.Object({
		scope: Type.Union([Type.Literal("personal"), Type.Literal("org")]),
		tier: Type.String({ description: "Tier que resolvió los mínimos (cuenta u organización)" }),
	}),
});

export const UserIdParams = Type.Object({
	userId: Type.String({ minLength: 1, description: "ID del usuario" }),
});

export const OrgIdParams = Type.Object({
	orgId: Type.String({ minLength: 1, description: "ID de la organización" }),
});

export const OverrideIdParams = Type.Object({
	id: Type.String({ minLength: 1, description: "ID del override" }),
});

export const OverrideDto = Type.Object({
	id: Type.String(),
	subjectType: Type.String({ description: "user | org | role | org-members-default" }),
	subjectId: Type.String(),
	orgId: Type.Union([Type.String(), Type.Null()]),
	limitBytes: Type.Integer({ description: "-1 = sin límite" }),
	createdBy: Type.String(),
	createdAt: Type.String({ format: "date-time" }),
	updatedAt: Type.String({ format: "date-time" }),
});

export const OverridesListResponse = Type.Object({
	overrides: Type.Array(OverrideDto),
});

export const UpsertOverrideBody = Type.Object({
	subjectType: Type.Union([Type.Literal("user"), Type.Literal("org"), Type.Literal("role"), Type.Literal("org-members-default")]),
	subjectId: Type.String({ minLength: 1, maxLength: 80 }),
	limitBytes: Type.Integer({ minimum: -1, description: "-1 = sin límite (solo contexto global)" }),
});

export const OrgLimitsResponse = Type.Object({
	orgId: Type.String(),
	orgLimit: Type.Integer({ description: "-1 = sin límite" }),
	memberDefault: Type.Object({
		tierBytes: Type.Integer({ description: "Default del plan de la org; -1 = sin tope por miembro" }),
		overrideBytes: Type.Union([Type.Integer(), Type.Null()], { description: "Override `org-members-default` si existe" }),
		effectiveBytes: Type.Integer({ description: "Tope efectivo por miembro sin override propio; -1 = sin límite" }),
	}),
});

export const OrgUsageResponse = Type.Object({
	orgId: Type.String(),
	orgLimit: Type.Integer({ description: "-1 = sin límite" }),
	totalBytes: Type.Integer({ minimum: 0 }),
	totalCount: Type.Integer({ minimum: 0 }),
	members: Type.Array(
		Type.Object({
			userId: Type.String(),
			username: Type.Optional(Type.String()),
			totalBytes: Type.Integer({ minimum: 0 }),
			totalCount: Type.Integer({ minimum: 0 }),
		})
	),
	memberCount: Type.Integer({ minimum: 0 }),
});

export const ReconcileResponse = Type.Object({
	apps: Type.Array(Type.String()),
	usersUpdated: Type.Integer({ minimum: 0 }),
});
