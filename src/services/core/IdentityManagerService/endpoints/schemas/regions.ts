import { Type } from "@sinclair/typebox";

const RegionMetadata = Type.Record(Type.String(), Type.Unknown(), {
	description: "Metadata extensible de la región (objectConnectionUri, cacheConnectionUri, …)",
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

// ── Params ───────────────────────────────────────────────────────────────

export const RegionPathParams = Type.Object({
	path: Type.String({ minLength: 1, description: "Path único de la región" }),
});

// ── Body ─────────────────────────────────────────────────────────────────

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
