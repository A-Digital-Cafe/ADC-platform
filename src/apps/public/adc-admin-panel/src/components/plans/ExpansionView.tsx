import { useEffect, useRef, useState } from "react";
import { toast } from "@ui-library/utils/toast";
import { fetchExpansion, setExpansion, type ExpansionState } from "../../utils/plans-api.ts";

interface ToggleProps {
	readonly granted: boolean;
	readonly disabled: boolean;
	readonly onChange: (next: boolean) => void;
}

/** `adc-toggle` emite el evento custom `adcChange`: en React se engancha por ref. */
function GrantToggle({ granted, disabled, onChange }: ToggleProps) {
	const ref = useRef<HTMLElement>(null);
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const handler = (e: Event) => onChange((e as CustomEvent<boolean>).detail);
		el.addEventListener("adcChange", handler);
		return () => el.removeEventListener("adcChange", handler);
	}, [onChange]);
	return <adc-toggle ref={ref} checked={granted} disabled={disabled} label={granted ? "Ampliación otorgada" : "Ampliación no otorgada"} />;
}

/** Ampliación de los pools compartidos de una organización: se consulta por orgId y se otorga o revoca. */
export function ExpansionView() {
	const [orgId, setOrgId] = useState("");
	const [current, setCurrent] = useState<ExpansionState | null>(null);
	const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
	const [busy, setBusy] = useState(false);

	const load = async (id: string) => {
		setState("loading");
		const found = await fetchExpansion(id);
		setCurrent(found);
		setState(found ? "ready" : "error");
	};

	const grant = async (granted: boolean) => {
		if (!current) return;
		setBusy(true);
		try {
			const res = await setExpansion(current.orgId, granted);
			if (res.ok) {
				toast.success(granted ? "Ampliación otorgada." : "Ampliación revocada.");
				await load(current.orgId);
			} else {
				toast.error(res.error ?? "No se pudo cambiar la ampliación.");
			}
		} finally {
			setBusy(false);
		}
	};

	return (
		<section className="flex flex-col gap-3">
			<p className="text-sm text-muted">
				Es la contraparte del ticket de tipo <em>AMPLIACIÓN</em>: amplía los pools compartidos de la organización, no el precio ni los
				asientos. Revocarla no toca la suscripción, sólo devuelve los límites del plan contratado.
			</p>

			<div className="flex flex-wrap items-center gap-2">
				<div className="min-w-64 flex-1">
					<adc-input value={orgId} placeholder="ID de la organización" onInput={(e: any) => setOrgId(e.target.value)} />
				</div>
				<adc-button size="small" variant="accent-outlined" label="Consultar" disabled={!orgId.trim()} onClick={() => load(orgId.trim())} />
			</div>

			{state === "loading" && <adc-skeleton variant="rectangular" height="120px" />}
			{state === "error" && (
				<adc-callout tone="error" role="alert">
					No se pudo leer la ampliación. Revisá el ID y que estés en contexto global: una organización no se la otorga a sí misma.
				</adc-callout>
			)}

			{state === "ready" && current && (
				<adc-card>
					<div className="flex flex-col gap-3 p-4">
						<div className="flex flex-wrap items-center gap-2">
							<h3 className="font-heading text-base font-bold text-text">{current.orgId}</h3>
							<adc-badge color="gray" size="sm">
								tier {current.tier}
							</adc-badge>
							<adc-badge color="blue" size="sm">
								{current.paidSeats} asientos pagos
							</adc-badge>
							<adc-badge color={current.granted ? "green" : "gray"} size="sm">
								{current.granted ? "ampliada" : "sin ampliar"}
							</adc-badge>
						</div>
						{!current.available && (
							<adc-callout tone="warning" role="alert">
								El plan <code>{current.tier}</code> no define valores de ampliación: otorgarla no cambiaría ningún límite.
							</adc-callout>
						)}
						<GrantToggle granted={current.granted} disabled={busy || (!current.available && !current.granted)} onChange={grant} />
					</div>
				</adc-card>
			)}
		</section>
	);
}
