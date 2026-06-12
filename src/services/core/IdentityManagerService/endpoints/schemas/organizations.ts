import { Type } from "@sinclair/typebox";
import { PermissionInput } from "./common.js";
import { UserResponse } from "./users.js";

const OrganizationStatus = Type.Union([Type.Literal("active"), Type.Literal("inactive"), Type.Literal("blocked")]);
const OrganizationTier = Type.Union([Type.Literal("default"), Type.Literal("team"), Type.Literal("enterprise")]);

// ── Entidad ────────────────────────────────────────────────────────────────

export const OrganizationResponse = Type.Object({
	orgId: Type.String(),
	slug: Type.String(),
	region: Type.String(),
	tier: OrganizationTier,
	status: OrganizationStatus,
	approved: Type.Boolean(),
	permissions: Type.Optional(Type.Array(PermissionInput)),
	metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
	createdAt: Type.String({ format: "date-time" }),
	updatedAt: Type.String({ format: "date-time" }),
});

export const OrganizationsListResponse = Type.Array(OrganizationResponse);
export const OrgMembersResponse = Type.Array(UserResponse);

// ── Params ───────────────────────────────────────────────────────────────

export const OrgIdParams = Type.Object({
	orgId: Type.String({ minLength: 1, description: "ID de la organización" }),
});

export const OrgSlugParams = Type.Object({
	slug: Type.String({ minLength: 1, description: "Slug a comprobar" }),
});

export const OrgMemberParams = Type.Object({
	orgId: Type.String({ minLength: 1, description: "ID de la organización" }),
	userId: Type.String({ minLength: 1, description: "ID del usuario" }),
});

// ── Body ─────────────────────────────────────────────────────────────────

export const CreateOrgBody = Type.Object({
	slug: Type.String({ minLength: 1, maxLength: 64, pattern: "^[a-z0-9-]+$" }),
	region: Type.Optional(Type.String()),
	metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

export const UpdateOrgBody = Type.Partial(
	Type.Object({
		slug: Type.String({ minLength: 1, maxLength: 64, pattern: "^[a-z0-9-]+$" }),
		region: Type.String(),
		status: OrganizationStatus,
		metadata: Type.Record(Type.String(), Type.Unknown()),
	})
);

export const AddOrgMemberBody = Type.Object({
	roleIds: Type.Optional(Type.Array(Type.String())),
});

// ── Responses ──────────────────────────────────────────────────────────────

export const CheckSlugResponse = Type.Object({
	available: Type.Boolean(),
	reserved: Type.Optional(Type.Boolean()),
});

export const OrgSlugResponse = Type.Object({
	slug: Type.String(),
});
