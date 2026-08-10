import { createAdcApi } from "@ui-library/utils/adc-fetch";
import type { FeatureDef, FeatureValue, PlanAxis, PlanFeatureValue, PlanPrice, PlanSubjectType, UpsertPlanOverrideInput } from "@common/types/plans/index.ts";

export type { FeatureDef, FeatureValue, PlanAxis, PlanFeatureValue, PlanPrice, PlanSubjectType, UpsertPlanOverrideInput };

const api = createAdcApi({ basePath: "/api/plans/admin", devPort: 3000 });

/** Sal de la clave de idempotencia: la plataforma rechaza con 400 toda mutación sin el header. */
/**
 * Resultado de una mutación. Todas las llamadas van en `silent` porque esta app no
 * monta `adc-custom-error`: el error se perdería en silencio, así que se devuelve el
 * mensaje del backend para que el panel lo muestre tal cual.
 */
export interface MutationResult {
	ok: boolean;
	error?: string;
}

/** Plan del catálogo admin: incluye las features no vendibles y los topes por miembro. */
export interface AdminPlan {
	axis: PlanAxis;
	tier: string;
	/** Ausente ⇒ el plan NO está a la venta. */
	price?: PlanPrice;
	includedSeats?: number;
	features: Record<string, PlanFeatureValue>;
	memberFeatures?: Record<string, PlanFeatureValue>;
}

export interface AdminCatalog {
	features: FeatureDef[];
	plans: AdminPlan[];
}

/** Parche de edición: `price: null` saca el plan de venta; ausente deja el precio como está. */
export interface UpdatePlanInput {
	price?: PlanPrice | null;
	includedSeats?: number;
	features?: Record<string, PlanFeatureValue>;
	memberFeatures?: Record<string, PlanFeatureValue>;
}

export interface PlanOverrideDto {
	id: string;
	subjectType: PlanSubjectType;
	subjectId: string;
	orgId: string | null;
	featureKey: string;
	value: FeatureValue;
	createdBy: string;
	createdAt: string;
	updatedAt: string;
}

/** Página de excepciones: `total` es el conteo real del filtro, no el de la página. */
export interface OverridesPage {
	overrides: PlanOverrideDto[];
	total: number;
}

export interface OverridesFilter {
	featureKey?: string;
	subjectType?: PlanSubjectType;
	subjectId?: string;
	limit: number;
	offset: number;
}

export interface ExpansionState {
	orgId: string;
	tier: string;
	granted: boolean;
	paidSeats: number;
	/** `false` si el plan de la org no define ampliación: no hay nada que otorgar. */
	available: boolean;
}

const planPath = (axis: PlanAxis, tier: string) => `/plans/${axis}/${encodeURIComponent(tier)}`;
const expansionPath = (orgId: string) => `/orgs/${encodeURIComponent(orgId)}/expansion`;
const fail = (res: { errorKey?: string; message?: string }): MutationResult => ({ ok: false, error: res.message ?? res.errorKey });

/** Catálogo completo; `null` si no se pudo leer (sin permisos o servicio caído). */
export async function fetchCatalog(): Promise<AdminCatalog | null> {
	const res = await api.get<AdminCatalog>("/plans", { silent: true });
	return res.success && res.data ? res.data : null;
}

export async function updatePlan(axis: PlanAxis, tier: string, patch: UpdatePlanInput): Promise<MutationResult> {
	const res = await api.put(planPath(axis, tier), { body: patch, silent: true });
	return res.success ? { ok: true } : fail(res);
}

export async function resetPlan(axis: PlanAxis, tier: string): Promise<MutationResult> {
	const res = await api.delete(`${planPath(axis, tier)}/customization`, { silent: true });
	return res.success ? { ok: true } : fail(res);
}

export async function fetchOverrides(f: OverridesFilter): Promise<OverridesPage | null> {
	// Un filtro vacío viaja como ausente: `featureKey=""` filtraría por la clave vacía.
	const filters = { featureKey: f.featureKey || undefined, subjectType: f.subjectType || undefined, subjectId: f.subjectId || undefined };
	const res = await api.get<OverridesPage>("/overrides", { params: { ...filters, limit: f.limit, offset: f.offset }, silent: true });
	return res.success && res.data ? res.data : null;
}

export async function upsertOverride(input: UpsertPlanOverrideInput): Promise<MutationResult> {
	const res = await api.put("/overrides", { body: input, silent: true });
	return res.success ? { ok: true } : fail(res);
}

export async function removeOverride(id: string): Promise<MutationResult> {
	const res = await api.delete(`/overrides/${encodeURIComponent(id)}`, { silent: true });
	return res.success ? { ok: true } : fail(res);
}

/** Estado de la ampliación de una org; `null` si la org no existe o no hay permisos. */
export async function fetchExpansion(orgId: string): Promise<ExpansionState | null> {
	const res = await api.get<ExpansionState>(expansionPath(orgId), { silent: true });
	return res.success && res.data ? res.data : null;
}

export async function setExpansion(orgId: string, granted: boolean): Promise<MutationResult> {
	const res = await api.put(expansionPath(orgId), { body: { granted }, silent: true });
	return res.success ? { ok: true } : fail(res);
}
