import { UNLIMITED, type UpsertPlanOverrideInput } from "@common/types/plans/index.ts";
import { PlanError } from "@common/types/custom-errors/PlanError.ts";
import type { PlanSubjectType } from "../domain/index.ts";

const SUBJECT_TYPES: ReadonlySet<PlanSubjectType> = new Set(["user", "org", "role", "org-members-default"]);

/**
 * Validación de forma de un override, previa a cualquier lectura de la base.
 *
 * Es shape + rango, no autorización: la jerarquía (sujeto de la org del actor,
 * clamp contra el valor de la org) la aplica `OverridesManager`.
 */
export function validateOverrideInput(input: UpsertPlanOverrideInput): void {
	if (!input.subjectId || typeof input.subjectId !== "string") {
		throw new PlanError(400, "MISSING_FIELDS", "`subjectId` requerido");
	}
	if (!input.featureKey || typeof input.featureKey !== "string") {
		throw new PlanError(400, "MISSING_FIELDS", "`featureKey` requerido");
	}
	if (!SUBJECT_TYPES.has(input.subjectType)) {
		throw new PlanError(400, "INVALID_FIELD", "`subjectType` debe ser user|org|role|org-members-default");
	}
	const t = typeof input.value;
	if (t !== "number" && t !== "boolean" && t !== "string") {
		throw new PlanError(400, "INVALID_FIELD", "`value` debe ser number, boolean o string");
	}
	if (t === "number") {
		const n = input.value as number;
		if (!Number.isInteger(n) || (n < 0 && n !== UNLIMITED)) {
			throw new PlanError(400, "INVALID_FIELD", "`value` numérico debe ser un entero ≥ 0 o -1 (ilimitado)");
		}
	}
}
