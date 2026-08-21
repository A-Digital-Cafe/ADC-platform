import { useCallback, useEffect, useState } from "react";
import { fetchRuns, type LegalRun } from "../../utils/legal-api.ts";
import { RUN_LABELS } from "./legal-labels.ts";

const TONE: Record<string, "gray" | "blue" | "orange"> = { pdf: "gray", announce: "blue", rebuild: "orange" };

/**
 * Historial de los automatismos que tocan los documentos legales.
 *
 * Es la respuesta a «no sé qué corrió ni cuándo»: hasta ahora la generación de PDF dejaba un
 * `console.log` en el arranque de producción y el aviso de cambio de versión, una clave en Redis.
 * Ninguno de los dos era consultable después.
 */
export function RunHistory({ reloadKey }: { readonly reloadKey: number }) {
	const [items, setItems] = useState<LegalRun[]>([]);
	const [cursor, setCursor] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);

	const load = useCallback(async (from?: string) => {
		setLoading(true);
		const page = await fetchRuns(from);
		if (page) {
			setItems((prev) => (from ? [...prev, ...page.items] : page.items));
			setCursor(page.nextCursor);
		}
		setLoading(false);
	}, []);

	useEffect(() => {
		void load();
	}, [load, reloadKey]);

	return (
		<section className="rounded-lg border border-divider bg-surface p-4">
			<h3 className="font-heading text-base font-semibold text-text">Historial</h3>
			<p className="mb-3 text-sm text-muted">
				Generaciones de PDF, avisos y regeneraciones forzadas — las automáticas del arranque incluidas.
			</p>

			{loading && items.length === 0 && <p className="text-sm text-muted">Cargando…</p>}
			{!loading && items.length === 0 && <p className="text-sm text-muted">Todavía no corrió nada en este despliegue.</p>}

			<ul className="flex flex-col gap-2">
				{items.map((run) => (
					<li key={run.id} className="rounded-md border border-divider bg-surface p-3 text-sm">
						<div className="flex flex-wrap items-center gap-2">
							<span className="text-xs text-muted">{new Date(run.at).toLocaleString()}</span>
							<adc-badge color={TONE[run.kind] ?? "gray"} size="sm">
								{RUN_LABELS[run.kind] ?? run.kind}
							</adc-badge>
							{!run.ok && (
								<adc-badge color="red" size="sm">
									Falló
								</adc-badge>
							)}
							<span className="text-xs text-muted">
								{run.nodeId} · {run.actorUserId ? `por ${run.actorUserId}` : "automático"}
							</span>
						</div>
						<p className="mt-1 text-muted">{run.summary}</p>
					</li>
				))}
			</ul>

			{cursor && (
				<adc-button
					variant="accent-outlined"
					size="small"
					class="mt-3 block"
					label={loading ? "Cargando…" : "Ver más"}
					disabled={loading}
					onClick={() => void load(cursor)}
				/>
			)}
		</section>
	);
}
