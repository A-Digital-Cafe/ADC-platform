import { RegisterEndpoint, type EndpointCtx } from "../../EndpointManagerService/index.js";
import { IdentityError } from "@common/types/custom-errors/IdentityError.js";
import { P } from "@common/types/Permissions.ts";
import type IdentityManagerService from "../index.js";

/**
 * Endpoint para obtener estadísticas del usuario autenticado sobre identity.
 *
 * Nota: el antiguo endpoint `/my-permissions` fue retirado. Los clientes obtienen
 * los permisos bitfield, `isAdmin`, `isOrgAdmin` y `groupIds` vía `GET /api/auth/session`.
 */
export class StatsEndpoints {
	private static identity: IdentityManagerService;

	static init(identity: IdentityManagerService): void {
		StatsEndpoints.identity ??= identity;
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/identity/stats",
		permissions: [P.IDENTITY.STATS.READ],
		options: {
			tag: "IdentityManagerService/Stats",
			summary: "Estadísticas globales de identidad",
			description: "Solo accesible en modo global (admin sin organización activa).",
		},
	})
	static async getStats(ctx: EndpointCtx) {
		if (ctx.user?.orgId) {
			throw new IdentityError(403, "GLOBAL_ONLY", "Las estadísticas globales requieren acceso global (modo personal)");
		}
		return StatsEndpoints.identity.getStats(ctx.token!);
	}
}
