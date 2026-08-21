import { useState } from "react";
import { resolvePlatformPath } from "@ui-library/utils/platform-links";
import type { LegalDocOverview } from "../../utils/legal-api.ts";
import { humanBytes, needsAttention, shortDate, shortHash, stateLine, stateTone } from "./legal-labels.ts";

interface Props {
	readonly doc: LegalDocOverview;
	/** Fechas que le tocarían a un bump hecho hoy: se muestran cuando el documento ya rige. */
	readonly nextVersion: { version: string; effectiveFrom: string };
	readonly onRebuild: (doc: LegalDocOverview) => void;
	readonly onAnnounce: (doc: LegalDocOverview) => void;
	readonly busy: boolean;
}

function helpLink(path: string): string {
	return resolvePlatformPath("help", path) ?? path;
}

/**
 * Un documento legal.
 *
 * En reposo dice una sola frase; crece sólo cuando hay algo que resolver, y en ese caso arranca
 * abierta. La alternativa —volcar hashes, rutas y fechas siempre— es lo que hoy hay en el `.ts` y
 * es justamente lo que nadie lee.
 */
export function DocCard({ doc, nextVersion, onRebuild, onAnnounce, busy }: Props) {
	const attention = needsAttention(doc);
	const [open, setOpen] = useState(attention);
	const tone = stateTone(doc);

	const copyHash = () => {
		if (doc.deployedHash) void navigator.clipboard?.writeText(doc.deployedHash);
	};

	return (
		<article className="rounded-lg border border-divider bg-surface p-4">
			<header className="flex flex-wrap items-start justify-between gap-2">
				<div>
					<h3 className="font-heading text-base font-semibold text-text">{doc.label}</h3>
					<p className="text-sm text-muted">{stateLine(doc)}</p>
				</div>
				<div className="flex items-center gap-2">
					<adc-badge color={tone.color} size="sm">
						{tone.text}
					</adc-badge>
					<adc-button
						variant="accent-outlined"
						size="small"
						label={open ? "Ocultar" : "Detalle"}
						aria-expanded={open}
						onClick={() => setOpen(!open)}
					/>
				</div>
			</header>

			{doc.drifted && (
				<adc-callout tone="warning" class="mt-3 block" role="alert">
					{doc.state === "en-preaviso" ? (
						<>
							El archivo desplegado no coincide con el hash sellado. Estás dentro de la ventana de corrección (hasta el{" "}
							{doc.effectiveFrom}): podés corregir el texto <strong>sin subir la versión</strong> ni pedir que nadie vuelva a aceptar.
							Actualizá <code>contentHash</code> en <code>src/common/utils/legal-docs.ts</code> y sumá la corrección a{" "}
							<code>corrections</code>.
						</>
					) : (
						<>
							El texto cambió <strong>después</strong> de entrar en vigor. Esto exige versionar:{" "}
							<code>version: &quot;{nextVersion.version}&quot;</code>, <code>effectiveFrom: &quot;{nextVersion.effectiveFrom}&quot;</code>{" "}
							y el <code>contentHash</code> nuevo.
						</>
					)}
				</adc-callout>
			)}

			{doc.deployedHash === null && (
				<adc-callout tone="error" class="mt-3 block" role="alert">
					No se encuentra <code>{doc.sourcePath}</code> en este nodo, así que no se puede verificar qué texto está publicado.
				</adc-callout>
			)}

			{!doc.noticeOk && (
				<adc-callout tone="error" class="mt-3 block" role="alert">
					Esta versión da {doc.noticeDays} día(s) de preaviso. Los Términos comprometen 30: publicar así incumple lo prometido.
				</adc-callout>
			)}

			{open && (
				<div className="mt-4 flex flex-col gap-4 border-t border-divider pt-4 text-sm">
					{(doc.drifted || doc.deployedHash !== null) && (
						<div>
							<span className="mb-1 block text-xs uppercase tracking-wide text-muted">Hash del texto</span>
							<p className="font-mono text-xs text-muted">sellado&nbsp;&nbsp;&nbsp;{shortHash(doc.sealedHash)}</p>
							{doc.deployedHash && (
								<p className="flex flex-wrap items-center gap-2 font-mono text-xs text-text">
									desplegado {shortHash(doc.deployedHash)}
									{doc.drifted && (
										<adc-button variant="accent-outlined" size="small" label="Copiar hash nuevo" onClick={copyHash} />
									)}
								</p>
							)}
							<p className="mt-1 text-xs text-muted">
								Fuente: <code>{doc.sourcePath}</code>
							</p>
						</div>
					)}

					<div>
						<span className="mb-1 block text-xs uppercase tracking-wide text-muted">PDF congelado en este nodo</span>
						{doc.pdf ? (
							<p className="flex flex-wrap items-center gap-2 text-muted">
								<a className="text-accent underline" href={helpLink(doc.pdf.href)} target="_blank" rel="noopener noreferrer">
									{doc.pdf.file}
								</a>
								<span className="text-xs">
									{humanBytes(doc.pdf.bytes)} · generado el {new Date(doc.pdf.generatedAt).toLocaleString()}
								</span>
								<adc-button
									variant="danger"
									size="small"
									label="Rehacer"
									disabled={busy}
									onClick={() => onRebuild(doc)}
								/>
							</p>
						) : (
							<p className="text-muted">
								Todavía no existe. Se genera solo al arrancar y con «Generar PDF faltantes»; hasta entonces el enlace de descarga de{" "}
								<a className="text-accent underline" href={helpLink(doc.href)} target="_blank" rel="noopener noreferrer">
									{doc.href}
								</a>{" "}
								no resuelve.
							</p>
						)}
					</div>

					{doc.corrections.length > 0 && (
						<div>
							<span className="mb-1 block text-xs uppercase tracking-wide text-muted">
								Correcciones aplicadas antes de la vigencia ({doc.corrections.length})
							</span>
							<ul className="flex flex-col gap-2">
								{doc.corrections.map((c) => (
									<li key={c.date} className="text-muted">
										<span className="mr-2 font-mono text-xs text-text">{shortDate(c.date)}</span>
										{c.summary}
									</li>
								))}
							</ul>
						</div>
					)}

					<div className="flex flex-wrap items-center gap-2">
						<adc-button
							variant="accent-outlined"
							size="small"
							label="Re-enviar el aviso de esta versión"
							disabled={busy}
							onClick={() => onAnnounce(doc)}
						/>
						<span className="text-xs text-muted">
							{doc.requiresAcceptance
								? "Sólo si el aviso automático no salió: quien ya lo recibió no lo recibe de nuevo."
								: "Documento informativo: se anuncia igual, pero nunca se pide re-aceptarlo."}
						</span>
					</div>
				</div>
			)}
		</article>
	);
}
