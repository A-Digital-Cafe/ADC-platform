import { Type } from "@sinclair/typebox";
import { FeatureValue, PagingQuery } from "./common.ts";

/** Schemas de excepciones de límite y de la ampliación de una organización. */

const SubjectType = Type.Union([Type.Literal("user"), Type.Literal("org"), Type.Literal("role"), Type.Literal("org-members-default")]);

export const OverrideIdParams = Type.Object({
	id: Type.String({ minLength: 1, description: "ID del override" }),
});

export const OverrideDto = Type.Object({
	id: Type.String(),
	subjectType: Type.String({ description: "user | org | role | org-members-default" }),
	subjectId: Type.String(),
	orgId: Type.Union([Type.String(), Type.Null()]),
	featureKey: Type.String(),
	value: FeatureValue,
	createdBy: Type.String(),
	createdAt: Type.String({ format: "date-time" }),
	updatedAt: Type.String({ format: "date-time" }),
});

export const OverridesListResponse = Type.Object({
	overrides: Type.Array(OverrideDto),
	total: Type.Integer({ description: "Conteo real del filtro, no de la página" }),
});

export const OverridesQuery = Type.Object({
	featureKey: Type.Optional(Type.String({ maxLength: 120 })),
	subjectType: Type.Optional(SubjectType),
	subjectId: Type.Optional(Type.String({ maxLength: 80 })),
	...PagingQuery,
});

export const UpsertOverrideBody = Type.Object({
	subjectType: SubjectType,
	subjectId: Type.String({ minLength: 1, maxLength: 80 }),
	featureKey: Type.String({ minLength: 1, maxLength: 120 }),
	value: FeatureValue,
});

export const ExpansionResponse = Type.Object({
	orgId: Type.String(),
	tier: Type.String(),
	granted: Type.Boolean(),
	paidSeats: Type.Integer(),
	/** `false` si el plan de la org no define una ampliación (no hay nada que otorgar). */
	available: Type.Boolean(),
});

export const SetExpansionBody = Type.Object({
	granted: Type.Boolean({ description: "true = otorgar la ampliación; false = revocarla" }),
});
