import { useCallback, useEffect, useState } from "react";
import { toast } from "@ui-library/utils/toast";
import { listBreaches, openBreach, type BreachSummary } from "../../utils/breach-api.ts";
import { STATE_COLOR, STATE_LABEL } from "./breach-labels.ts";
import { BreachDetail } from "./BreachDetail.tsx";
import { OpenBreachModal } from "./OpenBreachModal.tsx";

/** Registro de incidentes de datos personales: lista + asistente de instrucción. */
export default function BreachPanel({ canWrite, canExecute }: Readonly<{ canWrite: boolean; canExecute: boolean }>) {
	const [items, setItems] = useState<BreachSummary[]>([]);
	const [selected, setSelected] = useState<string | null>(null);
	const [opening, setOpening] = useState(false);
	const [loading, setLoading] = useState(true);

	const refresh = useCallback(async () => {
		setLoading(true);
		setItems(await listBreaches());
		setLoading(false);
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	return (
		<div className="flex flex-col gap-6">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<p className="max-w-3xl text-sm text-muted">
					Registro del art. 33.5 y procedimiento guiado de notificación. El plazo de 72 horas ante la autoridad corre desde la fecha de
					detección que se carga al abrir el incidente. El procedimiento completo está en la guía de respuesta a incidentes.
				</p>
				{canWrite && <adc-button variant="danger" size="small" label="Abrir incidente" onClick={() => setOpening(true)} />}
			</div>

			{loading && <p className="text-sm text-muted">Cargando…</p>}

			{!loading && items.length === 0 && (
				<adc-callout tone="success" role="note">
					No hay incidentes registrados.
				</adc-callout>
			)}

			{items.length > 0 && (
				<ul className="flex flex-col gap-2">
					{items.map((b) => (
						<li key={b.id}>
							<button
								type="button"
								className={`flex w-full flex-wrap items-center gap-3 rounded-lg border p-3 text-left text-sm ${
									selected === b.id ? "border-primary" : "border-border"
								}`}
								onClick={() => setSelected(selected === b.id ? null : b.id)}
							>
								<span className="font-mono text-xs text-muted">{b.ref}</span>
								<span className="min-w-40 flex-1 text-text">{b.title}</span>
								{b.highRisk && <adc-badge color="red">Riesgo alto</adc-badge>}
								<adc-badge color={STATE_COLOR[b.state]}>{STATE_LABEL[b.state]}</adc-badge>
								<span className="text-xs text-muted">{new Date(b.detectedAt).toLocaleDateString()}</span>
							</button>
						</li>
					))}
				</ul>
			)}

			{selected && <BreachDetail id={selected} canExecute={canExecute} onChanged={() => void refresh()} />}

			{opening && (
				<OpenBreachModal
					onClose={() => setOpening(false)}
					onSubmit={async (input) => {
						setOpening(false);
						const res = await openBreach(input);
						if (!res.ok) {
							toast.error(res.error ?? "No se pudo abrir el incidente.");
							return;
						}
						toast.success(`Incidente ${res.data?.ref} abierto. El plazo ante la autoridad ya corre.`);
						await refresh();
						if (res.data?.id) setSelected(res.data.id);
					}}
				/>
			)}
		</div>
	);
}
