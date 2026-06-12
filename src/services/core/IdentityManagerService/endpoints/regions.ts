import { RegisterEndpoint, type EndpointCtx } from "../../EndpointManagerService/index.js";
import { IdentityError } from "@common/types/custom-errors/IdentityError.js";
import { P } from "@common/types/Permissions.ts";
import type IdentityManagerService from "../index.js";
import * as RGS from "./schemas/regions.js";
import { SuccessResponse } from "./schemas/common.js";

/** Region management is global-only. Users in org mode cannot manage these. */
function requireGlobalAccess(ctx: EndpointCtx): void {
	if (ctx.user?.orgId) {
		throw new IdentityError(403, "GLOBAL_ONLY", "La gestión de regiones requiere acceso global (modo personal)");
	}
}

/**
 * Endpoints HTTP para gestión de regiones
 */
export class RegionEndpoints {
	private static identity: IdentityManagerService;

	static init(identity: IdentityManagerService): void {
		RegionEndpoints.identity ??= identity;
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/identity/regions",
		permissions: [P.IDENTITY.REGIONS.READ],
		options: {
			tag: "IdentityManagerService/Regions",
			summary: "Lista regiones",
			description: "Gestión global (modo personal): los usuarios en modo org no pueden acceder.",
			schema: { response: { 200: RGS.RegionsListResponse } },
		},
	})
	static async listRegions(ctx: EndpointCtx) {
		requireGlobalAccess(ctx);
		return RegionEndpoints.identity.regions.getAllRegions(ctx.token!);
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/identity/regions/:path",
		permissions: [P.IDENTITY.REGIONS.READ],
		options: {
			tag: "IdentityManagerService/Regions",
			summary: "Obtiene una región por path",
			schema: { params: RGS.RegionPathParams, response: { 200: RGS.RegionResponse } },
		},
	})
	static async getRegion(ctx: EndpointCtx<{ path: string }>) {
		requireGlobalAccess(ctx);
		const region = await RegionEndpoints.identity.regions.getRegion(ctx.params.path, ctx.token!);
		if (!region) throw new IdentityError(404, "REGION_NOT_FOUND", "Región no encontrada");
		return region;
	}

	@RegisterEndpoint({
		method: "POST",
		url: "/api/identity/regions",
		permissions: [P.IDENTITY.REGIONS.WRITE],
		options: {
			tag: "IdentityManagerService/Regions",
			summary: "Crea una región",
			schema: { body: RGS.CreateRegionBody, response: { 200: RGS.RegionResponse } },
		},
	})
	static async createRegion(ctx: EndpointCtx<Record<string, string>, { path: string; metadata: any; isGlobal?: boolean }>) {
		requireGlobalAccess(ctx);
		if (!ctx.data?.path) {
			throw new IdentityError(400, "MISSING_FIELDS", "path es requerido");
		}
		return RegionEndpoints.identity.regions.createRegion(ctx.data.path, ctx.data.metadata || {}, ctx.data.isGlobal, ctx.token!);
	}

	@RegisterEndpoint({
		method: "PUT",
		url: "/api/identity/regions/:path",
		permissions: [P.IDENTITY.REGIONS.UPDATE],
		options: {
			tag: "IdentityManagerService/Regions",
			summary: "Actualiza una región",
			schema: { params: RGS.RegionPathParams, body: RGS.UpdateRegionBody, response: { 200: RGS.RegionResponse } },
		},
	})
	static async updateRegion(ctx: EndpointCtx<{ path: string }, Partial<{ metadata: any; isGlobal: boolean; isActive: boolean }>>) {
		requireGlobalAccess(ctx);
		return RegionEndpoints.identity.regions.updateRegion(ctx.params.path, ctx.data || {}, ctx.token!);
	}

	@RegisterEndpoint({
		method: "DELETE",
		url: "/api/identity/regions/:path",
		permissions: [P.IDENTITY.REGIONS.DELETE],
		options: {
			tag: "IdentityManagerService/Regions",
			summary: "Elimina una región",
			schema: { params: RGS.RegionPathParams, response: { 200: SuccessResponse } },
		},
	})
	static async deleteRegion(ctx: EndpointCtx<{ path: string }>) {
		requireGlobalAccess(ctx);
		await RegionEndpoints.identity.regions.deleteRegion(ctx.params.path, ctx.token!);
		return { success: true };
	}
}
