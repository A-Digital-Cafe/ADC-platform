import { RegisterEndpoint, type EndpointCtx } from "@services/core/EndpointManagerService/index.js";
import { P } from "@common/types/Permissions.ts";
import { StorageError } from "@common/types/custom-errors/StorageError.ts";
import type StorageQuotaService from "../index.js";
import * as S from "./schemas/storage.js";

/**
 * Endpoints de consulta de uso. Los de administración exigen `storage.usage.read`
 * y validan contexto: un org admin solo ve usuarios/agregados de SU org.
 */
export class UsageEndpoints {
	private static service: StorageQuotaService;
	private static kernelKey: symbol;

	static init(service: StorageQuotaService, kernelKey: symbol): void {
		UsageEndpoints.service ??= service;
		UsageEndpoints.kernelKey ??= kernelKey;
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/storage/usage/me",
		deferAuth: true,
		options: {
			tag: "StorageQuotaService/Usage",
			summary: "Uso de almacenamiento del usuario actual en su contexto activo",
			description:
				"Devuelve el uso por app, total y el límite efectivo (`-1` = sin límite) del contexto del token: personal (sin org) u organización activa. Cada contexto lleva contadores separados.",
			schema: { response: { 200: S.UsageSnapshotResponse } },
		},
	})
	static async myUsage(ctx: EndpointCtx) {
		const userId = ctx.user?.id;
		if (!userId) throw new StorageError(401, "NOT_AUTHENTICATED", "Autenticación requerida");
		return UsageEndpoints.service.quota.getUsage({ userId, orgId: ctx.user?.orgId ?? null });
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/storage/apps",
		deferAuth: true,
		options: {
			tag: "StorageQuotaService/Usage",
			summary: "Apps consumidoras de almacenamiento registradas",
			description: "Incluye el mínimo garantizado por app resuelto para el contexto/tier del caller.",
			schema: { response: { 200: S.AppsResponse } },
		},
	})
	static async apps(ctx: EndpointCtx) {
		const userId = ctx.user?.id;
		if (!userId) throw new StorageError(401, "NOT_AUTHENTICATED", "Autenticación requerida");
		const svc = UsageEndpoints.service;
		const profile = await svc.limits.resolveQuotaProfile({ userId, orgId: ctx.user?.orgId ?? null });
		return { apps: svc.quota.listApps(profile.scope), context: { scope: profile.scope.kind, tier: profile.scope.tier } };
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/storage/admin/users/:userId/usage",
		permissions: [P.STORAGE.USAGE.READ],
		options: {
			tag: "StorageQuotaService/Admin",
			summary: "Uso de almacenamiento de un usuario (admin)",
			description:
				"Devuelve el uso del usuario en el contexto del caller (personal si global, org si org admin). En contexto organización, el usuario objetivo debe ser miembro de la organización del token.",
			schema: { params: S.UserIdParams, response: { 200: S.UsageSnapshotResponse } },
		},
	})
	static async userUsage(ctx: EndpointCtx<{ userId: string }>) {
		const svc = UsageEndpoints.service;
		const callerOrgId = ctx.user?.orgId ?? null;
		await svc.assertUserVisibleFromContext(UsageEndpoints.kernelKey, ctx.params.userId, callerOrgId);
		return svc.quota.getUsage({ userId: ctx.params.userId, orgId: callerOrgId });
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/storage/admin/orgs/:orgId/usage",
		permissions: [P.STORAGE.USAGE.READ],
		options: {
			tag: "StorageQuotaService/Admin",
			summary: "Uso agregado de una organización (admin)",
			description: "Suma los contadores de los miembros. Un org admin solo puede consultar su propia organización.",
			schema: { params: S.OrgIdParams, response: { 200: S.OrgUsageResponse } },
		},
	})
	static async orgUsage(ctx: EndpointCtx<{ orgId: string }>) {
		const svc = UsageEndpoints.service;
		const callerOrgId = ctx.user?.orgId ?? null;
		if (callerOrgId && callerOrgId !== ctx.params.orgId) {
			throw new StorageError(403, "ORG_ACCESS_DENIED", "No tienes acceso a esta organización");
		}
		return svc.getOrgUsage(UsageEndpoints.kernelKey, ctx.params.orgId);
	}

	@RegisterEndpoint({
		method: "POST",
		url: "/api/storage/admin/reconcile",
		permissions: [P.STORAGE.USAGE.UPDATE],
		options: {
			tag: "StorageQuotaService/Admin",
			summary: "Reconstruye los contadores desde los attachments reales (admin global)",
			rateLimit: { max: 1, timeWindow: 60_000 },
			schema: { response: { 200: S.ReconcileResponse } },
		},
	})
	static async reconcile(ctx: EndpointCtx) {
		if (ctx.user?.orgId) {
			throw new StorageError(403, "GLOBAL_ONLY", "La reconciliación requiere acceso global (modo personal)");
		}
		return UsageEndpoints.service.quota.reconcile();
	}
}
