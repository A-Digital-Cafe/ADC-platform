import type { EndpointCtx } from "@services/core/EndpointManagerService/index.js";
import { PlanError } from "@common/types/custom-errors/PlanError.ts";
import type { PlanOverride, PlanOverrideActor } from "@common/types/plans/index.ts";

/** Sólo se lee `ctx.user`/`ctx.query`, así que los genéricos del ctx dan igual. */
type AnyCtx = Pick<EndpointCtx<never, unknown>, "user" | "query">;

/**
 * Actor administrativo derivado **del token**, nunca del body: un admin de
 * organización queda forzado a su org y el DAO valida la jerarquía desde ahí.
 */
export function adminActor(ctx: AnyCtx): PlanOverrideActor {
	const userId = ctx.user?.id;
	if (!userId) throw new PlanError(401, "NOT_AUTHENTICATED", "Autenticación requerida");
	return { userId, orgId: ctx.user?.orgId ?? null };
}

/**
 * Exige contexto global. Lo usan las operaciones que son decisión de la plataforma
 * (editar el catálogo, otorgar una ampliación): una org no se las concede a sí misma.
 */
export function assertGlobalActor(ctx: AnyCtx, what: string): void {
	if (ctx.user?.orgId) throw new PlanError(403, "GLOBAL_ONLY", `${what} se administran en contexto global`);
}

/**
 * Paginación de un listado. El validador de querystring NO coerciona tipos: los
 * numéricos llegan como string y se parsean acá (el clamp real vive en el DAO).
 */
export function paging(ctx: AnyCtx): { limit?: number; offset?: number } {
	const num = (raw: string | undefined): number | undefined => {
		const n = Number(raw);
		return raw !== undefined && Number.isFinite(n) ? n : undefined;
	};
	return { limit: num(ctx.query?.limit), offset: num(ctx.query?.offset) };
}

/** Serialización estable de un override (fechas en ISO). */
export function toOverrideDto(o: PlanOverride) {
	return {
		id: o.id,
		subjectType: o.subjectType,
		subjectId: o.subjectId,
		orgId: o.orgId ?? null,
		featureKey: o.featureKey,
		value: o.value,
		createdBy: o.createdBy,
		createdAt: new Date(o.createdAt).toISOString(),
		updatedAt: new Date(o.updatedAt).toISOString(),
	};
}
