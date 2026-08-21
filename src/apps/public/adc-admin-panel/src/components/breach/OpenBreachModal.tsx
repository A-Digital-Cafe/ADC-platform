import { useState } from "react";
import type { BreachOpenInput } from "../../utils/breach-api.ts";
import { SOURCE_LABEL } from "./breach-labels.ts";

/** Fecha-hora local en el formato que espera `datetime-local`, para prellenar "ahora". */
function nowLocal(): string {
	const d = new Date();
	d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
	return d.toISOString().slice(0, 16);
}

export function OpenBreachModal({ onClose, onSubmit }: Readonly<{ onClose: () => void; onSubmit: (input: BreachOpenInput) => void }>) {
	const [title, setTitle] = useState("");
	const [detectedAt, setDetectedAt] = useState(nowLocal());
	const [source, setSource] = useState<BreachOpenInput["source"]>("internal");
	const [sourceRef, setSourceRef] = useState("");
	const [nature, setNature] = useState("");

	return (
		<adc-modal open onadcClose={onClose}>
			<div className="flex flex-col gap-4 p-1">
				<div>
					<h2 className="font-heading text-xl font-bold text-text">Abrir incidente de datos personales</h2>
					<p className="mt-1 text-sm text-muted">
						Abrilo antes de investigar: la fecha de detección es la constancia del conocimiento del hecho y de ahí salen las 72 horas
						para notificar a la autoridad.
					</p>
				</div>

				<label className="flex flex-col gap-1 text-xs text-muted">
					Título
					<adc-input value={title} onInput={(e: any) => setTitle(e.target.value)} placeholder="Qué pasó, en una línea" />
				</label>

				<label className="flex flex-col gap-1 text-xs text-muted">
					Fecha y hora de detección
					<input
						type="datetime-local"
						value={detectedAt}
						onChange={(e) => setDetectedAt(e.target.value)}
						className="rounded-lg border border-divider bg-surface px-3 py-2 text-sm text-text"
					/>
				</label>

				<label className="flex flex-col gap-1 text-xs text-muted">
					Origen
					<select
						value={source}
						onChange={(e) => setSource(e.target.value as BreachOpenInput["source"])}
						className="rounded-lg border border-divider bg-surface px-3 py-2 text-sm text-text"
					>
						{Object.entries(SOURCE_LABEL).map(([value, label]) => (
							<option key={value} value={value}>
								{label}
							</option>
						))}
					</select>
				</label>

				<label className="flex flex-col gap-1 text-xs text-muted">
					Referencia de origen (ticket, expediente)
					<adc-input value={sourceRef} onInput={(e: any) => setSourceRef(e.target.value)} />
				</label>

				<label className="flex flex-col gap-1 text-xs text-muted">
					Qué se sabe hasta ahora
					<adc-textarea value={nature} onInput={(e: any) => setNature(e.target.value)} rows={4} />
				</label>

				<div className="flex justify-end gap-2">
					<adc-button variant="accent-outlined" label="Cancelar" onClick={onClose} />
					<adc-button
						variant="danger"
						label="Abrir incidente"
						disabled={title.trim().length < 5 || !detectedAt}
						onClick={() =>
							onSubmit({
								title: title.trim(),
								detectedAt: new Date(detectedAt).toISOString(),
								source,
								sourceRef: sourceRef.trim() || undefined,
								nature: nature.trim() || undefined,
							})
						}
					/>
				</div>
			</div>
		</adc-modal>
	);
}
