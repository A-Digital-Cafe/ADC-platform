import { UNLIMITED, type FeatureValue, type UpsertPlanOverrideInput } from "@common/types/plans/index.ts";
import { PlanError } from "@common/types/custom-errors/PlanError.ts";
import type { PlanSubjectType } from "../domain/index.ts";
import type { IdentitySource } from "./TierResolver.ts";

/** Valor efectivo de una feature a nivel organización; `undefined` si no aplica. */
export type OrgCeilingResolver = (orgId: string, featureKey: string) => Promise<FeatureValue | undefined>;

/**
 * Reglas de jerarquía que aplican a un actor **de organización**.
 *
 * Un admin global no pasa por acá: puede administrar cualquier sujeto, incluido el
 * nivel `org` y el valor `-1`.
 */
export async function assertOrgActorMayWrite(
	actorOrgId: string,
	input: UpsertPlanOverrideInput,
	deps: { identity: IdentitySource; ceiling: OrgCeilingResolver | null }
): Promise<void> {
	if (input.subjectType === "org") {
		throw new PlanError(403, "GLOBAL_ONLY", "Los límites de organización se administran en contexto global");
	}
	if (input.value === UNLIMITED) {
		throw new PlanError(403, "UNLIMITED_FORBIDDEN", "Una organización no puede asignar límites ilimitados");
	}
	if (input.subjectType === "org-members-default") {
		if (input.subjectId !== actorOrgId) {
			throw new PlanError(403, "ORG_ACCESS_DENIED", "Solo puedes ajustar el default de tu organización");
		}
	} else {
		await assertSubjectInOrg(input.subjectType, input.subjectId, actorOrgId, deps.identity);
	}
	await assertWithinOrgCeiling(actorOrgId, input, deps.ceiling);
}

/**
 * Un admin de organización no puede asignar por encima de lo que la org tiene.
 *
 * La resolución igual clampea en lectura, así que esto no es lo que garantiza el
 * límite: es para que el panel conteste con un motivo en vez de aceptar un número
 * que después se recorta en silencio.
 */
async function assertWithinOrgCeiling(actorOrgId: string, input: UpsertPlanOverrideInput, ceiling: OrgCeilingResolver | null): Promise<void> {
	if (typeof input.value !== "number" || !ceiling) return;
	const orgLimit = await ceiling(actorOrgId, input.featureKey).catch(() => undefined);
	if (typeof orgLimit !== "number" || orgLimit === UNLIMITED) return;
	if (input.value > orgLimit) {
		throw new PlanError(403, "LIMIT_EXCEEDS_ORG", "El valor supera el disponible de la organización", {
			featureKey: input.featureKey,
			orgLimit,
		});
	}
}

/** Verifica que el sujeto (user/role) pertenezca a la org del actor. */
async function assertSubjectInOrg(subjectType: PlanSubjectType, subjectId: string, orgId: string, identity: IdentitySource): Promise<void> {
	if (subjectType === "user") {
		const user = await identity.getUser(subjectId);
		const isMember = user?.orgMemberships?.some((m) => m.orgId === orgId) ?? false;
		if (!isMember) throw new PlanError(403, "ORG_ACCESS_DENIED", "El usuario no pertenece a tu organización");
		return;
	}
	const role = await identity.getRole(subjectId);
	if (role?.orgId !== orgId) {
		throw new PlanError(403, "ORG_ACCESS_DENIED", "El rol no pertenece a tu organización");
	}
}
