import { Type } from "@sinclair/typebox";

const RegionMetadata = Type.Record(Type.String(), Type.Unknown(), {
	description: "Metadata extensible de la región. Única clave con efecto: objectConnectionUri (Mongo de las orgs de la región)",
});

// ── Entidad ────────────────────────────────────────────────────────────────

export const RegionResponse = Type.Object({
	path: Type.String(),
	isGlobal: Type.Boolean(),
	isActive: Type.Boolean(),
	metadata: RegionMetadata,
	createdAt: Type.String({ format: "date-time" }),
	updatedAt: Type.String({ format: "date-time" }),
});

export const RegionsListResponse = Type.Array(RegionResponse);

export const RegionPathParams = Type.Object({
	path: Type.String({ minLength: 1, description: "Path único de la región" }),
});

export const CreateRegionBody = Type.Object({
	path: Type.String({ minLength: 1 }),
	metadata: Type.Optional(RegionMetadata),
	isGlobal: Type.Optional(Type.Boolean()),
});

export const UpdateRegionBody = Type.Partial(
	Type.Object({
		metadata: RegionMetadata,
		isGlobal: Type.Boolean(),
		isActive: Type.Boolean(),
	})
);
