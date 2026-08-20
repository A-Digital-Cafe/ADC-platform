import { useCallback, useEffect, useState } from "react";
import { announceDoc, buildPdfs, fetchOverview, rebuildPdf, type LegalDocOverview, type LegalOverview } from "../../utils/legal-api.ts";
import { AdoptionCard } from "./AdoptionCard.tsx";
import { DocCard } from "./DocCard.tsx";
import { RebuildModal } from "./RebuildModal.tsx";
import { RunHistory } from "./RunHistory.tsx";
import { needsAttention } from "./legal-labels.ts";

/**
 * Tab «Legales».
 *
 * Reúne lo que hasta ahora estaba en cinco lugares que no se hablaban: la metadata en un `.ts`, un
 * hook de git que reescribía hashes entre repos, un script colgado del arranque de producción, un
 * anunciador escondido en el servicio de sesiones y las constancias de aceptación, que nadie
 * agregaba. Todo lo que muestra es **el estado de este nodo**: el texto legal viaja en el código y
 * el PDF congelado vive en el volumen de cada despliegue, así que otro nodo puede responder
 * distinto — y poder verlo es el punto.
 *
 * Lo que sigue siendo un cambio de código, a propósito: publicar una versión nueva. El texto vive
 * en el `.tsx` y su número tiene que viajar con él en el mismo despliegue; si el número se
 * administrara desde acá, un nodo podría servir un texto mientras la base afirma otra versión.
 */
export default function LegalPanel() {
	const [data, setData] = useState<LegalOverview | null>(null);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
	const [rebuilding, setRebuilding] = useState<LegalDocOverview | null>(null);
	const [historyKey, setHistoryKey] = useState(0);

	const refresh = useCallback(async () => {
		setLoading(true);
		setData(await fetchOverview());
		setLoading(false);
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	/** Toda acción refresca el estado y el historial: son justamente lo que la acción cambió. */
	const run = async (action: () => Promise<{ ok: boolean; error?: string }>, okText: string) => {
		setBusy(true);
		setNotice(null);
		const result = await action();
		setNotice(result.ok ? { tone: "success", text: okText } : { tone: "error", text: result.error ?? "No se pudo completar la operación." });
		setBusy(false);
		setHistoryKey((k) => k + 1);
		await refresh();
	};

	if (loading && !data) return <p className="text-sm text-muted">Cargando…</p>;

	if (!data) {
		return (
			<adc-callout tone="error" role="alert">
				No se pudo leer el estado de los documentos legales. Puede que <code>LegalDocsService</code> no esté cargado en este nodo.
			</adc-callout>
		);
	}

	const pending = data.docs.filter(needsAttention).length;
	const missingPdfs = data.docs.some((d) => !d.pdf);

	return (
		<section className="flex flex-col gap-4">
			<div>
				<h2 className="font-heading text-lg font-semibold text-text">Documentos legales</h2>
				<p className="text-sm text-muted">
					Qué rige, desde cuándo, si el texto desplegado sigue siendo el que la versión sella y qué copia congelada tiene este nodo (
					<span className="font-mono text-xs">{data.nodeId}</span>).{" "}
					{pending === 0 ? "No hay nada pendiente." : `${pending} de ${data.docs.length} necesitan atención.`}
				</p>
			</div>

			{notice && (
				<adc-callout tone={notice.tone === "success" ? "success" : "error"} role="alert">
					{notice.text}
				</adc-callout>
			)}

			<div className="flex flex-wrap items-center gap-2">
				<adc-button variant="accent-outlined" size="small" label="Refrescar" disabled={busy} onClick={() => void refresh()} />
				<adc-button
					variant="primary"
					size="small"
					label="Generar PDF faltantes"
					disabled={busy || !missingPdfs}
					onClick={() => void run(buildPdfs, "PDF generados.")}
				/>
				{!missingPdfs && <span className="text-xs text-muted">Los cuatro PDF ya están congelados en este nodo.</span>}
			</div>

			<div className="grid gap-3">
				{data.docs.map((doc) => (
					<DocCard
						key={doc.id}
						doc={doc}
						nextVersion={data.nextVersion}
						busy={busy}
						onRebuild={setRebuilding}
						onAnnounce={(d) => void run(() => announceDoc(d.id), `Aviso de ${d.label} enviado.`)}
					/>
				))}
			</div>

			<AdoptionCard adoption={data.adoption} />
			<RunHistory reloadKey={historyKey} />

			{rebuilding && (
				<RebuildModal
					doc={rebuilding}
					onClose={() => setRebuilding(null)}
					onConfirm={(reason) => {
						const doc = rebuilding;
						setRebuilding(null);
						void run(() => rebuildPdf(doc.id, reason), `PDF de ${doc.label} regenerado.`);
					}}
				/>
			)}
		</section>
	);
}
