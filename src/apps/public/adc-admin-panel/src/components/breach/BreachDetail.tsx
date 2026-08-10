import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "@ui-library/utils/toast";
import type { BreachDataCategory, BreachRiskLevel, BreachSubjectExemption } from "@common/types/security/Breach.ts";
import { BREACH_TRANSITIONS } from "@common/types/security/Breach.ts";
import {
	annotateBreach,
	fetchTemplates,
	getBreach,
	notifySubjects,
	setAudience,
	transitionBreach,
	type BreachRecord,
	type BreachTemplates,
	type BreachTransitionInput,
} from "../../utils/breach-api.ts";
import {
	CATEGORY_KEYS,
	CATEGORY_LABEL,
	EXEMPTION_LABEL,
	RISK_LEVEL_KEYS,
	RISK_LEVEL_LABEL,
	SOURCE_LABEL,
	STATE_COLOR,
	STATE_LABEL,
	STEP_HELP,
} from "./breach-labels.ts";

function Countdown({ deadline, done }: Readonly<{ deadline: string; done: boolean }>) {
	const left = new Date(deadline).getTime() - Date.now();
	if (done) return <adc-badge color="green">Notificado a la autoridad</adc-badge>;
	const hours = Math.floor(Math.abs(left) / 3_600_000);
	return (
		<adc-badge color={left < 0 ? "red" : hours < 12 ? "orange" : "blue"}>
			{left < 0 ? `Plazo vencido hace ${hours} h` : `${hours} h para notificar a la autoridad`}
		</adc-badge>
	);
}

function Field({ label, hint, children }: Readonly<{ label: string; hint?: string; children: React.ReactNode }>) {
	return (
		<label className="flex flex-col gap-1 text-xs text-muted">
			{label}
			{children}
			{hint && <span className="text-xs text-muted/80">{hint}</span>}
		</label>
	);
}

/**
 * Asistente de instrucción del incidente. La izquierda es el expediente (lo que ya consta) y la
 * derecha el paso siguiente con sólo los campos que ese paso exige: el procedimiento manda, no
 * un formulario con todo a la vez.
 *
 * `canExecute` es el permiso EXECUTE del registro: sin él sólo se puede leer y anotar, así que los
 * controles que mueven el expediente ni se pintan (el backend los rechazaría con un 403 opaco).
 */
export function BreachDetail({ id, canExecute, onChanged }: Readonly<{ id: string; canExecute: boolean; onChanged: () => void }>) {
	const [breach, setBreach] = useState<BreachRecord | null>(null);
	const [templates, setTemplates] = useState<BreachTemplates | null>(null);
	const [busy, setBusy] = useState(false);
	const [draft, setDraft] = useState<BreachTransitionInput | null>(null);
	const [audienceRaw, setAudienceRaw] = useState("");
	const [note, setNote] = useState("");

	const reload = useCallback(async () => {
		const [doc, tpl] = await Promise.all([getBreach(id), fetchTemplates(id)]);
		setBreach(doc);
		setTemplates(tpl);
		setDraft(null);
	}, [id]);

	useEffect(() => {
		void reload();
	}, [reload]);

	const next = useMemo(() => (breach ? (BREACH_TRANSITIONS[breach.state] ?? []) : []), [breach]);

	if (!breach) return <p className="text-sm text-muted">Cargando incidente…</p>;

	const patch = (p: Partial<BreachTransitionInput>) => setDraft((d) => ({ ...(d ?? { to: next[0] }), ...p }) as BreachTransitionInput);

	const run = async <T,>(fn: () => Promise<{ ok: boolean; error?: string; data?: T }>, okMsg: string | ((data?: T) => string)) => {
		setBusy(true);
		const res = await fn();
		setBusy(false);
		if (!res.ok) {
			toast.error(res.error ?? "La operación falló.");
			return;
		}
		toast.success(typeof okMsg === "function" ? okMsg(res.data) : okMsg);
		await reload();
		onChanged();
	};

	const target = draft?.to ?? next[0];
	const { audienceSize, deliveredCount, queuedCount } = breach.subjects;
	const unreached = Math.max(audienceSize - deliveredCount - queuedCount, 0);

	return (
		<div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
			<section className="flex flex-col gap-4">
				<header className="flex flex-wrap items-center gap-2">
					<span className="font-mono text-xs text-muted">{breach.ref}</span>
					<h2 className="flex-1 font-heading text-xl font-bold text-text">{breach.title}</h2>
					<adc-badge color={STATE_COLOR[breach.state]}>{STATE_LABEL[breach.state]}</adc-badge>
					<Countdown
						deadline={breach.authorityDeadlineAt as unknown as string}
						done={!!breach.authority.notifiedAt || !breach.authority.required}
					/>
				</header>

				<dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
					<div>
						<dt className="text-xs text-muted">Detectado</dt>
						<dd className="text-text">{new Date(breach.detectedAt).toLocaleString()}</dd>
					</div>
					<div>
						<dt className="text-xs text-muted">Origen</dt>
						<dd className="text-text">{SOURCE_LABEL[breach.source] ?? breach.source}</dd>
					</div>
					<div>
						<dt className="text-xs text-muted">Riesgo alto</dt>
						<dd className="text-text">{breach.risk.highRisk ? "Sí" : "No"}</dd>
					</div>
					<div>
						<dt className="text-xs text-muted">Personas</dt>
						<dd className="text-text">{breach.approxSubjects ?? "—"}</dd>
					</div>
				</dl>

				{breach.nature && (
					<div>
						<h3 className="text-sm font-semibold text-text">Naturaleza del incidente</h3>
						<p className="whitespace-pre-wrap text-sm text-muted">{breach.nature}</p>
					</div>
				)}

				{breach.dataCategories.length > 0 && (
					<p className="text-sm text-muted">
						<strong className="text-text">Datos alcanzados:</strong> {breach.dataCategories.map((c) => CATEGORY_LABEL[c]).join(", ")}
					</p>
				)}

				{breach.containment.length > 0 && (
					<div>
						<h3 className="text-sm font-semibold text-text">Contención</h3>
						<ul className="mt-1 flex flex-col gap-1 text-sm text-muted">
							{breach.containment.map((s) => (
								<li key={`${s.at}-${s.text}`}>
									<span className="text-xs text-muted/80">{new Date(s.at).toLocaleString()} · </span>
									{s.text}
								</li>
							))}
						</ul>
					</div>
				)}

				{breach.subjects.required && (
					<adc-callout tone={unreached === 0 && breach.subjects.audienceSize > 0 ? "success" : "warning"} role="note">
						Aviso a personas afectadas: {breach.subjects.deliveredCount} de {breach.subjects.audienceSize} entregados
						{breach.subjects.queuedCount > 0 ? ` · ${breach.subjects.queuedCount} en cola` : ""}
						{unreached > 0 ? ` · ${unreached} sin despachar (reintentables)` : ""}
						{breach.subjects.exemption ? ` · excepción invocada: ${EXEMPTION_LABEL[breach.subjects.exemption]}` : ""}
					</adc-callout>
				)}

				<div>
					<h3 className="text-sm font-semibold text-text">Diario de la instrucción</h3>
					<ul className="mt-1 flex flex-col gap-1 text-sm">
						{[...breach.events].reverse().map((e, i) => (
							<li key={`${e.at}-${i}`} className="text-muted">
								<span className="text-xs text-muted/80">{new Date(e.at).toLocaleString()}</span>
								{e.to && <adc-badge color={STATE_COLOR[e.to]}>{STATE_LABEL[e.to]}</adc-badge>}
								{e.note && <span> {e.note}</span>}
							</li>
						))}
					</ul>
					<div className="mt-2 flex gap-2">
						<adc-input value={note} onInput={(e: any) => setNote(e.target.value)} placeholder="Anotar sin mover el estado" />
						<adc-button
							variant="accent-outlined"
							size="small"
							label="Anotar"
							disabled={!note.trim() || busy}
							onClick={() =>
								run(async () => {
									const res = await annotateBreach(id, note.trim());
									if (res.ok) setNote("");
									return res;
								}, "Anotado.")
							}
						/>
					</div>
				</div>
			</section>

			<section className="flex flex-col gap-4 rounded-lg border border-border p-4">
				<h3 className="font-heading text-lg font-semibold text-text">Paso siguiente</h3>
				{STEP_HELP[breach.state] && <p className="text-sm text-muted">{STEP_HELP[breach.state]}</p>}

				{next.length > 0 && !canExecute && (
					<adc-callout tone="warning" role="note">
						Tu rol puede leer y anotar el expediente, pero no moverlo. Instruir el incidente exige el permiso de ejecución sobre el
						registro de brechas.
					</adc-callout>
				)}

				{next.length === 0 ? (
					<p className="text-sm text-muted">El incidente está cerrado. El registro se conserva sin plazo.</p>
				) : (
					canExecute && (
						<>
							{next.length > 1 && (
								<Field label="Qué hacer">
									<select
										value={target}
										onChange={(e) => patch({ to: e.target.value as BreachTransitionInput["to"] })}
										className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
									>
										{next.map((s) => (
											<option key={s} value={s}>
												{STATE_LABEL[s]}
											</option>
										))}
									</select>
								</Field>
							)}

							{(target === "assessing" || target === "contained") && (
								<Field label="Naturaleza del incidente (art. 33.3.a)">
									<adc-textarea
										rows={4}
										value={draft?.nature ?? breach.nature}
										onInput={(e: any) => patch({ nature: e.target.value })}
									/>
								</Field>
							)}

							{target === "contained" && (
								<>
									<Field label="Categorías de datos alcanzadas">
										<div className="flex flex-wrap gap-2">
											{CATEGORY_KEYS.map((c) => {
												const selected = (draft?.dataCategories ?? breach.dataCategories).includes(c);
												return (
													<button
														key={c}
														type="button"
														className={`rounded-full border px-3 py-1 text-xs ${selected ? "border-primary bg-primary/10 text-text" : "border-border text-muted"}`}
														onClick={() => {
															const current = new Set<BreachDataCategory>(
																draft?.dataCategories ?? breach.dataCategories
															);
															if (selected) current.delete(c);
															else current.add(c);
															patch({ dataCategories: [...current] });
														}}
													>
														{CATEGORY_LABEL[c]}
													</button>
												);
											})}
										</div>
									</Field>
									<Field label="Consecuencias probables (art. 33.3.c)">
										<adc-textarea
											rows={3}
											value={draft?.likelyConsequences ?? breach.likelyConsequences}
											onInput={(e: any) => patch({ likelyConsequences: e.target.value })}
										/>
									</Field>
									<Field label="Personas afectadas (aprox.)">
										<adc-input
											type="number"
											value={String(draft?.approxSubjects ?? breach.approxSubjects ?? "")}
											onInput={(e: any) => patch({ approxSubjects: e.target.value ? Number(e.target.value) : null })}
										/>
									</Field>
									<div className="grid grid-cols-2 gap-3">
										<Field label="Severidad">
											<select
												value={draft?.risk?.severity ?? breach.risk.severity}
												onChange={(e) =>
													patch({ risk: { ...draft?.risk, severity: e.target.value as BreachRiskLevel } })
												}
												className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
											>
												{RISK_LEVEL_KEYS.map((l) => (
													<option key={l} value={l}>
														{RISK_LEVEL_LABEL[l]}
													</option>
												))}
											</select>
										</Field>
										<Field label="Probabilidad">
											<select
												value={draft?.risk?.likelihood ?? breach.risk.likelihood}
												onChange={(e) =>
													patch({ risk: { ...draft?.risk, likelihood: e.target.value as BreachRiskLevel } })
												}
												className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
											>
												{RISK_LEVEL_KEYS.map((l) => (
													<option key={l} value={l}>
														{RISK_LEVEL_LABEL[l]}
													</option>
												))}
											</select>
										</Field>
									</div>
									<Field
										label="Riesgo alto para los derechos de las personas"
										hint="Marcarlo es lo que vuelve obligatorio el aviso individual (art. 34). Severidad y probabilidad son las que se citan ante la autoridad: dejarlas en baja contradice el riesgo alto."
									>
										<div className="flex items-center gap-2">
											<input
												type="checkbox"
												checked={draft?.risk?.highRisk ?? breach.risk.highRisk}
												onChange={(e) => patch({ risk: { ...draft?.risk, highRisk: e.target.checked } })}
											/>
											<span className="text-sm text-text">Sí, hay riesgo alto</span>
										</div>
									</Field>
									<Field label="Fundamento de la evaluación de riesgo">
										<adc-textarea
											rows={3}
											value={draft?.risk?.rationale ?? breach.risk.rationale}
											onInput={(e: any) => patch({ risk: { ...draft?.risk, rationale: e.target.value } })}
										/>
									</Field>
									<Field label="Medida de contención a registrar">
										<adc-input
											value={draft?.containmentStep ?? ""}
											onInput={(e: any) => patch({ containmentStep: e.target.value })}
										/>
									</Field>
								</>
							)}

							{target === "registered" && (
								<Field label="Medidas correctivas (art. 33.3.d / 33.5)">
									<adc-textarea
										rows={4}
										value={draft?.correctiveMeasures ?? breach.correctiveMeasures}
										onInput={(e: any) => patch({ correctiveMeasures: e.target.value })}
									/>
								</Field>
							)}

							{target === "authority_notified" && (
								<>
									<Field label="Fecha y hora de la notificación">
										<input
											type="datetime-local"
											value={draft?.authorityNotifiedAt ?? ""}
											onChange={(e) =>
												patch({
													authorityNotifiedAt: e.target.value ? new Date(e.target.value).toISOString() : undefined,
												})
											}
											className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
										/>
									</Field>
									<Field label="Texto enviado" hint="Pegá el texto tal como salió: el borrador no es prueba de nada.">
										<adc-textarea
											rows={5}
											value={draft?.authorityBody ?? templates?.authority ?? ""}
											onInput={(e: any) => patch({ authorityBody: e.target.value })}
										/>
									</Field>
									<Field label="Número de acuse (si lo hay)">
										<adc-input
											value={draft?.authorityAcknowledgementRef ?? ""}
											onInput={(e: any) => patch({ authorityAcknowledgementRef: e.target.value })}
										/>
									</Field>
									<Field
										label="Motivo de la demora"
										hint="Obligatorio sólo si se pasaron las 72 h; la política promete acompañarlo."
									>
										<adc-textarea
											rows={3}
											value={draft?.authorityDelayReason ?? ""}
											onInput={(e: any) => patch({ authorityDelayReason: e.target.value })}
										/>
									</Field>
								</>
							)}

							{target === "subjects_notified" && (
								<>
									<Field label="Excepción del art. 34.3 (opcional)">
										<select
											value={draft?.subjectsExemption ?? ""}
											onChange={(e) =>
												patch({ subjectsExemption: (e.target.value || undefined) as BreachSubjectExemption | undefined })
											}
											className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
										>
											<option value="">Sin excepción: se avisó una por una</option>
											{Object.entries(EXEMPTION_LABEL).map(([v, l]) => (
												<option key={v} value={v}>
													{l}
												</option>
											))}
										</select>
									</Field>
									{draft?.subjectsExemption && (
										<Field label="Fundamento de la excepción">
											<adc-textarea
												rows={3}
												value={draft?.subjectsExemptionRationale ?? ""}
												onInput={(e: any) => patch({ subjectsExemptionRationale: e.target.value })}
											/>
										</Field>
									)}
									{draft?.subjectsExemption === "disproportionate_effort" && (
										<Field label="URL de la comunicación pública">
											<adc-input
												value={draft?.subjectsPublicCommunicationUrl ?? ""}
												onInput={(e: any) => patch({ subjectsPublicCommunicationUrl: e.target.value })}
											/>
										</Field>
									)}
								</>
							)}

							{target === "no_notification" && (
								<Field
									label="Por qué no se notifica"
									hint="Es la decisión que una autoridad va a auditar. Se registra igual que notificar."
								>
									<adc-textarea
										rows={4}
										value={draft?.decisionRationale ?? ""}
										onInput={(e: any) => patch({ decisionRationale: e.target.value })}
									/>
								</Field>
							)}

							<Field label="Nota para el diario (opcional)">
								<adc-input value={draft?.note ?? ""} onInput={(e: any) => patch({ note: e.target.value })} />
							</Field>

							<adc-button
								variant="accent"
								label={`Pasar a "${STATE_LABEL[target]}"`}
								disabled={busy}
								onClick={() => run(() => transitionBreach(id, { ...(draft ?? {}), to: target }), "Incidente actualizado.")}
							/>
						</>
					)
				)}

				{canExecute && breach.risk.highRisk && breach.state !== "closed" && (
					<div className="mt-2 flex flex-col gap-2 border-t border-divider pt-4">
						<h4 className="text-sm font-semibold text-text">Aviso a las personas afectadas</h4>
						<Field
							label="Audiencia (un id de usuario por línea)"
							hint="Se congela antes de enviar: a quién se avisó es evidencia, no un efecto del envío."
						>
							<adc-textarea rows={4} value={audienceRaw} onInput={(e: any) => setAudienceRaw(e.target.value)} />
						</Field>
						<div className="flex flex-wrap gap-2">
							<adc-button
								variant="accent-outlined"
								size="small"
								label="Congelar audiencia"
								disabled={busy || !audienceRaw.trim()}
								onClick={() =>
									run(
										() =>
											setAudience(
												id,
												audienceRaw
													.split(/[\s,;]+/)
													.map((s) => s.trim())
													.filter(Boolean)
											),
										"Audiencia registrada."
									)
								}
							/>
							<adc-button
								variant="danger"
								size="small"
								label={unreached > 0 && breach.subjects.startedAt ? "Reintentar con quien falta" : "Avisar a las personas"}
								disabled={busy || audienceSize === 0 || (Boolean(breach.subjects.startedAt) && unreached === 0)}
								onClick={() =>
									run(
										() => notifySubjects(id, templates?.subjects.body),
										(d) =>
											d
												? `Aviso despachado: ${d.recipients} entregados, ${d.queued} en cola, ${d.pending} sin despachar.`
												: "Aviso despachado."
									)
								}
							/>
						</div>
					</div>
				)}

				{templates && (
					<details className="mt-2 border-t border-divider pt-4">
						<summary className="cursor-pointer text-sm font-semibold text-text">Borradores</summary>
						<h4 className="mt-3 text-xs text-muted">Notificación a la autoridad</h4>
						<pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-surface p-2 text-xs text-muted">
							{templates.authority}
						</pre>
						<h4 className="mt-3 text-xs text-muted">Aviso a las personas</h4>
						<pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-surface p-2 text-xs text-muted">
							{templates.subjects.body}
						</pre>
						<h4 className="mt-3 text-xs text-muted">Comunicación pública</h4>
						<pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-surface p-2 text-xs text-muted">
							{templates.publicCommunication}
						</pre>
					</details>
				)}
			</section>
		</div>
	);
}
