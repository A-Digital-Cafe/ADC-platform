import { RegisterEndpoint, type EndpointCtx } from "@services/core/EndpointManagerService/index.js";
import { P } from "@common/types/Permissions.ts";
import { StorageError } from "@common/types/custom-errors/StorageError.ts";
import type { QuotaSubjectType } from "@common/types/storage/quota.ts";
import type StorageQuotaService from "../index.js";
import * as S from "./schemas/storage.js";

interface UpsertOverrideBody {
	subjectType: QuotaSubjectType;
	subjectId: string;
	limitBytes: number;
}

/**
 * Administración de overrides de límite. El contexto del actor sale SIEMPRE del
 * token (`ctx.user.orgId`), nunca del body: un org admin queda forzado a su org
 * y el DAO valida la jerarquía (subject de su org, clamp ≤ límite org, sin -1).
 */
export class LimitsEndpoints {
	private static service: StorageQuotaService;
	private static kernelKey: symbol;

	static init(service: StorageQuotaService, kernelKey: symbol): void {
		LimitsEndpoints.service ??= service;
		LimitsEndpoints.kernelKey ??= kernelKey;
	}

	static #actor(ctx: EndpointCtx<never, unknown> | EndpointCtx) {
		const userId = ctx.user?.id;
		if (!userId) throw new StorageError(401, "NOT_AUTHENTICATED", "Autenticación requerida");
		return { userId, orgId: ctx.user?.orgId ?? null };
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/storage/admin/orgs/:orgId/limits",
		permissions: [P.STORAGE.LIMITS.READ],
		options: {
			tag: "StorageQuotaService/Admin",
			summary: "Límite de una organización y su default por miembro",
			description: "Un org admin solo puede consultar su propia organización.",
			schema: { params: S.OrgIdParams, response: { 200: S.OrgLimitsResponse } },
		},
	})
	static async orgLimits(ctx: EndpointCtx<{ orgId: string }>) {
		const callerOrgId = ctx.user?.orgId ?? null;
		if (callerOrgId && callerOrgId !== ctx.params.orgId) {
			throw new StorageError(403, "ORG_ACCESS_DENIED", "No tienes acceso a esta organización");
		}
		const { orgLimit, tierBytes, overrideBytes, effectiveBytes } = await LimitsEndpoints.service.limits.getOrgMemberDefault(ctx.params.orgId);
		return { orgId: ctx.params.orgId, orgLimit, memberDefault: { tierBytes, overrideBytes, effectiveBytes } };
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/storage/admin/overrides",
		permissions: [P.STORAGE.LIMITS.READ],
		options: {
			tag: "StorageQuotaService/Admin",
			summary: "Lista overrides de límite",
			description: "En contexto organización, el filtro se fuerza a los overrides de esa organización.",
			schema: { response: { 200: S.OverridesListResponse } },
		},
	})
	static async list(ctx: EndpointCtx) {
		const overrides = await LimitsEndpoints.service.limits.listOverrides(LimitsEndpoints.#actor(ctx));
		return { overrides: overrides.map((o) => LimitsEndpoints.service.toOverrideDto(o)) };
	}

	@RegisterEndpoint({
		method: "PUT",
		url: "/api/storage/admin/overrides",
		permissions: [P.STORAGE.LIMITS.UPDATE],
		options: {
			tag: "StorageQuotaService/Admin",
			summary: "Crea o actualiza un override de límite",
			description:
				"Admin global: cualquier subject (user/org/role/org-members-default), `-1` permitido. " +
				"Org admin: solo user/role de su organización o el `org-members-default` propio, límite ≤ disponible de la org, `-1` prohibido.",
			rateLimit: { max: 30, timeWindow: 60_000 },
			schema: { body: S.UpsertOverrideBody, response: { 200: S.OverrideDto } },
		},
	})
	static async upsert(ctx: EndpointCtx<Record<string, string>, UpsertOverrideBody>) {
		if (!ctx.data?.subjectId || !ctx.data?.subjectType || typeof ctx.data?.limitBytes !== "number") {
			throw new StorageError(400, "MISSING_FIELDS", "`subjectType`, `subjectId` y `limitBytes` requeridos");
		}
		const override = await LimitsEndpoints.service.limits.upsertOverride(LimitsEndpoints.#actor(ctx), {
			subjectType: ctx.data.subjectType,
			subjectId: ctx.data.subjectId.trim(),
			limitBytes: ctx.data.limitBytes,
		});
		return LimitsEndpoints.service.toOverrideDto(override);
	}

	@RegisterEndpoint({
		method: "DELETE",
		url: "/api/storage/admin/overrides/:id",
		permissions: [P.STORAGE.LIMITS.UPDATE],
		options: {
			tag: "StorageQuotaService/Admin",
			summary: "Elimina un override de límite",
			rateLimit: { max: 30, timeWindow: 60_000 },
			schema: { params: S.OverrideIdParams, response: { 200: S.OkResponse } },
		},
	})
	static async remove(ctx: EndpointCtx<{ id: string }>) {
		await LimitsEndpoints.service.limits.deleteOverride(LimitsEndpoints.#actor(ctx), ctx.params.id);
		return { ok: true };
	}
}
