import { useCallback, useEffect, useState } from "react";
import { toast } from "@ui-library/utils/toast";
import {
	fetchCatalog,
	fetchOverrides,
	removeOverride,
	upsertOverride,
	type FeatureDef,
	type MutationResult,
	type OverridesPage,
	type PlanSubjectType,
} from "../../utils/plans-api.ts";
import { OverrideModal } from "./OverrideModal.tsx";
import { OverridesPager } from "./OverridesPager.tsx";
import { OverridesTable } from "./OverridesTable.tsx";
import { SUBJECT_TYPES } from "./plan-values.ts";

const PAGE_SIZE = 25;
const SUBJECT_FILTER = JSON.stringify([{ value: "", label: "Cualquier sujeto" }, ...SUBJECT_TYPES]);

interface Filter {
	featureKey: string;
	subjectType: PlanSubjectType | "";
	subjectId: string;
}

const EMPTY: Filter = { featureKey: "", subjectType: "", subjectId: "" };

/** Excepciones de límite: filtros, alta/baja y paginación limit/offset (el backend da el total). */
export function OverridesView() {
	const [draft, setDraft] = useState<Filter>(EMPTY);
	const [applied, setApplied] = useState<Filter>(EMPTY);
	const [offset, setOffset] = useState(0);
	const [page, setPage] = useState<OverridesPage | null>(null);
	const [state, setState] = useState<"loading" | "ready" | "error">("loading");
	const [busy, setBusy] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);
	// Sólo para poner nombre a las claves: `plans.catalog` es otro scope, así que un rol
	// que administre excepciones y no el catálogo se queda sin nombres, no sin la vista.
	const [defs, setDefs] = useState<FeatureDef[]>([]);

	useEffect(() => {
		fetchCatalog().then((catalog) => setDefs(catalog?.features ?? []));
	}, []);

	const load = useCallback(async () => {
		setState("loading");
		const res = await fetchOverrides({ ...applied, subjectType: applied.subjectType || undefined, limit: PAGE_SIZE, offset });
		setPage(res);
		setState(res ? "ready" : "error");
	}, [applied, offset]);

	useEffect(() => {
		load();
	}, [load]);

	const run = async (key: string, action: () => Promise<MutationResult>, okMsg: string) => {
		setBusy(key);
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

	const rows = page?.overrides ?? [];
	const total = page?.total ?? 0;
	const set = (patch: Partial<Filter>) => setDraft((prev) => ({ ...prev, ...patch }));
	const search = () => {
		setOffset(0);
		setApplied(draft);
	};

	return (
		<section className="flex flex-col gap-3">
			<div className="flex flex-wrap items-end gap-2">
				<div className="min-w-40 flex-1">
					<adc-input value={draft.featureKey} placeholder="Feature (drive.maxFileSize)" onInput={(e: any) => set({ featureKey: e.target.value })} />
				</div>
				<div className="w-52">
					<adc-select value={draft.subjectType} options={SUBJECT_FILTER} onChange={(e: any) => set({ subjectType: e.target.value })} />
				</div>
				<div className="min-w-40 flex-1">
					<adc-input value={draft.subjectId} placeholder="ID del sujeto" onInput={(e: any) => set({ subjectId: e.target.value })} />
				</div>
				<adc-button size="small" variant="accent-outlined" label="Buscar" onClick={search} />
				<adc-button size="small" variant="accent" label="Nueva excepción" onClick={() => setCreating(true)} />
			</div>

			{state === "loading" && <adc-skeleton variant="rectangular" height="240px" />}
			{state === "error" && (
				<adc-callout tone="error" role="alert">
					No se pudieron leer las excepciones. ¿Tenés permisos sobre los overrides de planes?
				</adc-callout>
			)}
			{state === "ready" && rows.length === 0 && (
				// Quitar el último de una página deja el offset colgado: "Buscar" vuelve a la primera.
				<adc-callout tone="info">{offset > 0 ? "Esta página quedó vacía: tocá Buscar." : "No hay excepciones para este filtro."}</adc-callout>
			)}

			{state === "ready" && rows.length > 0 && (
				<>
					<OverridesTable
						rows={rows}
						defs={defs}
						busy={busy}
						onRemove={(o) => run(o.id, () => removeOverride(o.id), `Excepción de ${o.featureKey} quitada.`)}
					/>
					<OverridesPager offset={offset} shown={rows.length} total={total} pageSize={PAGE_SIZE} onOffset={setOffset} />
				</>
			)}

			{creating && (
				<OverrideModal
					defs={defs}
					onClose={() => setCreating(false)}
					onSubmit={(input) => {
						setCreating(false);
						run("new", () => upsertOverride(input), `Excepción de ${input.featureKey} guardada.`);
					}}
				/>
			)}
		</section>
	);
}
