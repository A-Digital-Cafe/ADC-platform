import { useMemo, useState } from "react";
import { AdcTabs, type AdcTab } from "../AdcTabs.tsx";
import { ExpansionView } from "./ExpansionView.tsx";
import { OverridesView } from "./OverridesView.tsx";
import { PlanCatalogView } from "./PlanCatalogView.tsx";

type PlansView = "catalog" | "overrides" | "expansion";

interface Props {
	/** `plans.catalog`: editar la oferta. */
	readonly canCatalog: boolean;
	/** `plans.overrides`: excepciones por sujeto y ampliación de una organización. */
	readonly canOverrides: boolean;
}

/**
 * Tab de planes del panel de administración. Cada vista se carga sola contra
 * `/api/plans/admin/*`; acá sólo se decide cuál está disponible, porque catálogo y
 * excepciones son scopes de permiso distintos y un rol puede tener uno sin el otro.
 */
export default function PlansPanel({ canCatalog, canOverrides }: Props) {
	const tabs = useMemo(() => {
		const list: AdcTab[] = [];
		if (canCatalog) list.push({ id: "catalog", label: "Catálogo" });
		if (canOverrides) list.push({ id: "overrides", label: "Excepciones" }, { id: "expansion", label: "Ampliación" });
		return list;
	}, [canCatalog, canOverrides]);

	const [view, setView] = useState<PlansView>("catalog");

	if (tabs.length === 0) {
		return (
			<adc-callout tone="error" role="alert">
				Necesitás permisos globales sobre planes (catálogo o excepciones) para administrar la oferta.
			</adc-callout>
		);
	}

	// El tab activo puede no estar disponible (permiso parcial): se cae al primero visible.
	const active = (tabs.some((t) => t.id === view) ? view : tabs[0].id) as PlansView;

	return (
		<section className="flex flex-col gap-4">
			<div>
				<h2 className="font-heading text-lg font-semibold text-text">Planes</h2>
				<p className="text-sm text-muted">
					Oferta comercial, excepciones de límite por sujeto y ampliaciones. Todo pega directo contra el motor de entitlements.
				</p>
			</div>

			<AdcTabs tabs={tabs} activeId={active} onChange={(id: string) => setView(id as PlansView)} />

			{active === "catalog" && <PlanCatalogView />}
			{active === "overrides" && <OverridesView />}
			{active === "expansion" && <ExpansionView />}
		</section>
	);
}
