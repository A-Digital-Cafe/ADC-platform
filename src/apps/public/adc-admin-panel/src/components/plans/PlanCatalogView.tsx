import { useCallback, useEffect, useState } from "react";
import { toast } from "@ui-library/utils/toast";
import { fetchCatalog, resetPlan, updatePlan, type AdminCatalog, type AdminPlan, type MutationResult } from "../../utils/plans-api.ts";
import { PlanCatalogTable } from "./PlanCatalogTable.tsx";
import { PlanEditModal } from "./PlanEditModal.tsx";
import { PlanResetModal } from "./PlanResetModal.tsx";

const keyOf = (plan: AdminPlan) => `${plan.axis}:${plan.tier}`;

/** Catálogo de la oferta: un plan por eje/tier, editable y reseteable a los defaults del código. */
export function PlanCatalogView() {
	const [catalog, setCatalog] = useState<AdminCatalog | null>(null);
	const [state, setState] = useState<"loading" | "ready" | "error">("loading");
	const [busy, setBusy] = useState<string | null>(null);
	const [editing, setEditing] = useState<AdminPlan | null>(null);
	const [resetting, setResetting] = useState<AdminPlan | null>(null);

	const load = useCallback(async () => {
		setState("loading");
		const data = await fetchCatalog();
		setCatalog(data);
		setState(data ? "ready" : "error");
	}, []);

	useEffect(() => {
		load();
	}, [load]);

	const run = async (plan: AdminPlan, action: () => Promise<MutationResult>, okMsg: string) => {
		setBusy(keyOf(plan));
		try {
			const res = await action();
			if (res.ok) {
				toast.success(okMsg);
				await load();
			} else {
				toast.error(res.error ?? "La operación falló.");
			}
		} finally {
			setBusy(null);
		}
	};

	const plans = catalog?.plans ?? [];

	return (
		<section className="flex flex-col gap-3">
			<div className="flex items-start justify-between gap-3">
				<p className="text-sm text-muted">
					Los valores del código son defaults de desarrollo: la oferta real se publica desde afuera y cualquier edición de acá{" "}
					<span className="text-text">congela el plan</span> frente a esos defaults. {catalog?.features.length ?? 0} features registradas.
				</p>
				<adc-button variant="accent-outlined" size="small" label="Actualizar" onClick={() => load()} />
			</div>

			{state === "loading" && <adc-skeleton variant="rectangular" height="280px" />}
			{state === "error" && (
				<adc-callout tone="error" role="alert">
					No se pudo leer el catálogo. ¿Tenés permisos globales sobre planes y el PlanService está levantado?
				</adc-callout>
			)}
			{state === "ready" && plans.length === 0 && <adc-callout tone="info">Todavía no hay planes sembrados.</adc-callout>}
			{state === "ready" && plans.length > 0 && (
				<PlanCatalogTable plans={plans} keyOf={keyOf} busy={busy} onEdit={setEditing} onReset={setResetting} />
			)}

			{editing && (
				<PlanEditModal
					plan={editing}
					defs={catalog?.features ?? []}
					onClose={() => setEditing(null)}
					onSubmit={(patch) => {
						const plan = editing;
						setEditing(null);
						run(plan, () => updatePlan(plan.axis, plan.tier, patch), `Plan ${keyOf(plan)} actualizado.`);
					}}
				/>
			)}
			{resetting && (
				<PlanResetModal
					plan={resetting}
					onClose={() => setResetting(null)}
					onConfirm={() => {
						const plan = resetting;
						setResetting(null);
						run(plan, () => resetPlan(plan.axis, plan.tier), `Plan ${keyOf(plan)} devuelto a los defaults (sin precio).`);
					}}
				/>
			)}
		</section>
	);
}
