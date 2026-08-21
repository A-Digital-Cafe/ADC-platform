import { useCallback, useEffect, useState } from "react";
import { listAudit, type AuditEntry } from "../utils/breach-api.ts";

/**
 * Lectura del audit log persistente de acciones administrativas sobre datos personales.
 * Es el rastro que la página de respuesta a autoridades y el procedimiento de brechas citan
 * como registro auditable; hasta ahora el endpoint existía y no lo leía ninguna pantalla.
 */
export default function AuditPanel() {
	const [items, setItems] = useState<AuditEntry[]>([]);
	const [action, setAction] = useState("");
	const [loading, setLoading] = useState(true);

	const refresh = useCallback(async (filter: string) => {
		setLoading(true);
		setItems(await listAudit(filter.trim() || undefined));
		setLoading(false);
	}, []);

	useEffect(() => {
		void refresh("");
	}, [refresh]);

	return (
		<div className="flex flex-col gap-4">
			<p className="max-w-3xl text-sm text-muted">
				Registro append-only de acciones administrativas sobre datos personales (retención 2 años). El contexto guarda sólo
				identificadores y contadores: nunca direcciones de correo, IPs ni contenido.
			</p>

			<div className="flex flex-wrap gap-2">
				<adc-input value={action} onInput={(e: any) => setAction(e.target.value)} placeholder="Filtrar por acción (ej. breach.opened)" />
				<adc-button variant="accent-outlined" size="small" label="Buscar" onClick={() => void refresh(action)} />
			</div>

			{loading && <p className="text-sm text-muted">Cargando…</p>}
			{!loading && items.length === 0 && <p className="text-sm text-muted">Sin entradas para ese filtro.</p>}

			<ul className="flex flex-col gap-2">
				{items.map((e) => (
					<li key={e.id} className="rounded-lg border border-divider bg-surface p-3 text-sm">
						<div className="flex flex-wrap items-center gap-2">
							<span className="text-xs text-muted">{new Date(e.at).toLocaleString()}</span>
							<adc-badge color="blue">{e.action}</adc-badge>
							<span className="text-xs text-muted">{e.origin}</span>
						</div>
						<p className="mt-1 text-muted">
							actor <span className="font-mono text-xs">{e.actorUserId}</span>
							{e.targetUserId && (
								<>
									{" → "}
									<span className="font-mono text-xs">{e.targetUserId}</span>
								</>
							)}
							{e.targetResource && <span className="text-xs"> · {e.targetResource}</span>}
						</p>
						{e.context && <pre className="mt-1 overflow-auto text-xs text-muted/80">{JSON.stringify(e.context)}</pre>}
					</li>
				))}
			</ul>
		</div>
	);
}
