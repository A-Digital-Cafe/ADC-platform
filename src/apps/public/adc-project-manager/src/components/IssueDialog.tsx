import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";
import type { Permission } from "@common/types/identity/Permission.ts";
import type { Project } from "@common/types/project-manager/Project.ts";
import type { Issue, UrgencyImportance, Difficulty } from "@common/types/project-manager/Issue.ts";
import type { Sprint } from "@common/types/project-manager/Sprint.ts";
import type { Milestone } from "@common/types/project-manager/Milestone.ts";
import type { UpdateLogEntry } from "@common/types/project-manager/UpdateLogEntry.ts";
import type { CustomFieldValue } from "@common/types/project-manager/CustomField.ts";
import type { IssueLink } from "@common/types/project-manager/IssueLink.ts";
import type { Block } from "@common/ADC/types/learning.ts";
import type { Block as StencilBlock } from "@ui-library/utils/react-jsx";
import type { TransitionCommentSubmitDetail } from "./TransitionCommentModal.tsx";
import { TransitionCommentModal } from "./TransitionCommentModal.tsx";
import { pmApi } from "../utils/pm-api.ts";
import { useIssueMover } from "../hooks/useIssueMover.ts";
import { canUpdateIssue, canWriteProjectResource, Scope, type CallerCtx } from "../utils/permissions.ts";
import { UserPicker } from "./pickers/UserPicker.tsx";
import { GroupPicker } from "./pickers/GroupPicker.tsx";
import { CustomFieldsEditor } from "./pickers/CustomFieldsEditor.tsx";
import { IssueLinksEditor } from "./pickers/IssueLinksEditor.tsx";
import { IssueComments } from "./IssueComments.tsx";

interface Props {
	project: Project;
	issue: Issue | null;
	perms: Permission[];
	caller?: CallerCtx;
	sprints?: Sprint[];
	milestones?: Milestone[];
	onClose: () => void;
	onSaved: () => void | Promise<void>;
}

function toU(n: number): UrgencyImportance {
	const v = Math.max(0, Math.min(4, Math.round(n)));
	return v as UrgencyImportance;
}
function toD(n: number): Difficulty {
	if (!Number.isFinite(n) || n <= 0) return null;
	const v = Math.max(1, Math.min(5, Math.round(n)));
	return v as Difficulty;
}

export function IssueDialog({ project, issue, perms, caller, sprints = [], milestones = [], onClose, onSaved }: Readonly<Props>) {
	const { t } = useTranslation({ namespace: "adc-project-manager" });
	const isNew = !issue;
	const [form, setForm] = useState<{
		title: string;
		description: Block[];
		columnKey: string;
		sprintId: string;
		milestoneId: string;
		urgency: number;
		importance: number;
		difficulty: number;
		reason: string;
		assigneeIds: string[];
		assigneeGroupIds: string[];
		customFields: Record<string, CustomFieldValue>;
		linkedIssues: IssueLink[];
	}>({
		title: issue?.title ?? "",
		description: Array.isArray(issue?.description) ? issue.description : [],
		columnKey: issue?.columnKey ?? project.kanbanColumns.find((c) => c.isAuto)?.key ?? project.kanbanColumns[0]?.key ?? "todo",
		sprintId: issue?.sprintId ?? "",
		milestoneId: issue?.milestoneId ?? "",
		urgency: issue?.priority.urgency ?? 2,
		importance: issue?.priority.importance ?? 2,
		difficulty: (issue?.priority.difficulty ?? 3) as number,
		reason: "",
		assigneeIds: issue?.assigneeIds ?? [],
		assigneeGroupIds: issue?.assigneeGroupIds ?? [],
		customFields: issue?.customFields ?? {},
		linkedIssues: issue?.linkedIssues ?? [],
	});
	const [saving, setSaving] = useState(false);
	const [history, setHistory] = useState<UpdateLogEntry[]>([]);
	const [projectIssues, setProjectIssues] = useState<Issue[]>([]);
	const [bottomTab, setBottomTab] = useState<"comments" | "history">("comments");
	// Adjuntos referenciados en bloques de la descripción (para resolver URLs y
	// para enviar `attachmentIds` en el draft junto a `blocks`).
	const [descAttachmentIds, setDescAttachmentIds] = useState<string[]>([]);
	const [descAttachmentUrls, setDescAttachmentUrls] = useState<Record<string, string>>({});
	// Modo del bloque de descripción: por defecto se muestra renderizado y al
	// hacer click se entra en edición. Se guarda con su propio botón y vuelve
	// al modo solo-lectura. Issues nuevos arrancan directamente en edición.
	const [descEditing, setDescEditing] = useState<boolean>(isNew);
	const [savedDescription, setSavedDescription] = useState<Block[]>(Array.isArray(issue?.description) ? issue.description : []);
	const [hasUnsavedDraft, setHasUnsavedDraft] = useState<boolean>(false);
	const [draftDescription, setDraftDescription] = useState<Block[] | null>(null);
	const [draftAttachmentIds, setDraftAttachmentIds] = useState<string[]>([]);

	const mover = useIssueMover({
		project,
		onSuccess: async () => {
			await onSaved();
		},
	});

	const modalRef = useCallback(
		(el: HTMLElement | null) => {
			if (el) el.addEventListener("adcClose", onClose);
		},
		[onClose]
	);

	useEffect(() => {
		if (!issue) return;
		pmApi.getIssueHistory(issue.id).then((r) => {
			if (r.success && r.data) setHistory(r.data.updateLog);
		});
	}, [issue]);

	const canEdit = isNew ? canWriteProjectResource(perms, Scope.ISSUES, project, caller) : canUpdateIssue(perms, project, issue, caller);

	// Cargar el draft de descripción al abrir un issue existente. A diferencia
	// de los comentarios, no aplicamos el draft automáticamente: lo guardamos
	// aparte y mostramos un banner "tienes cambios sin guardar" clickeable.
	useEffect(() => {
		if (!issue || !canEdit) return;
		let cancelled = false;
		(async () => {
			const r = await pmApi.getIssueDescriptionDraft(issue.id).catch(() => null);
			if (cancelled) return;
			if (r?.success && r.data?.draft) {
				const draft = r.data.draft;
				setDraftDescription(draft.blocks ?? []);
				setDraftAttachmentIds(draft.attachmentIds ?? []);
				setHasUnsavedDraft(true);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [issue, canEdit]);
	// Resolver URLs de attachments referenciados en bloques de la descripción,
	// tanto en lo guardado como en el draft (para mostrar correctamente el
	// preview/render).
	const attachmentIdsToResolve = useMemo(() => {
		const ids = new Set<string>();
		const collect = (blocks: Block[]) => {
			for (const b of blocks) {
				if (b && typeof b === "object" && (b as { type?: string }).type === "attachment") {
					const aid = (b as { attachmentId?: string }).attachmentId;
					if (aid) ids.add(aid);
				}
			}
		};
		collect(savedDescription);
		collect(form.description);
		if (draftDescription) collect(draftDescription);
		return [...ids];
	}, [savedDescription, form.description, draftDescription]);

	useEffect(() => {
		if (!issue) return;
		const missing = attachmentIdsToResolve.filter((id) => !descAttachmentUrls[id]);
		if (missing.length === 0) return;
		let cancelled = false;
		(async () => {
			const updates: Record<string, string> = {};
			for (const id of missing) {
				const r = await pmApi.getIssueAttachmentDownloadUrl(issue.id, id, { inline: true });
				if (r.success && r.data?.url) updates[id] = r.data.url;
			}
			if (!cancelled && Object.keys(updates).length) {
				setDescAttachmentUrls((prev) => ({ ...prev, ...updates }));
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [issue, attachmentIdsToResolve, descAttachmentUrls]);

	useEffect(() => {
		if (project.issueLinkTypes.length === 0) return;
		pmApi.listIssues(project.id).then((r) => {
			if (r.success && r.data) setProjectIssues(r.data.issues);
		});
	}, [project.id, project.issueLinkTypes.length]);

	const save = async () => {
		setSaving(true);
		const payloadPriority = {
			urgency: toU(form.urgency),
			importance: toU(form.importance),
			difficulty: toD(form.difficulty),
		};
		if (isNew) {
			await pmApi.createIssue(project.id, {
				title: form.title,
				description: form.description,
				columnKey: form.columnKey,
				sprintId: form.sprintId || undefined,
				milestoneId: form.milestoneId || undefined,
				priority: payloadPriority,
				assigneeIds: form.assigneeIds,
				assigneeGroupIds: form.assigneeGroupIds,
				customFields: form.customFields,
				linkedIssues: form.linkedIssues,
			});
			setSaving(false);
			await onSaved();
			return;
		}
		if (issue) {
			const columnChanged = form.columnKey !== issue.columnKey;
			// Update everything except columnKey first; column change goes through the mover
			// to enforce `requireCommentOnFinalTransition` if applicable.
			await pmApi.updateIssue(issue.id, {
				title: form.title,
				description: form.description,
				columnKey: columnChanged ? issue.columnKey : form.columnKey,
				sprintId: form.sprintId || undefined,
				milestoneId: form.milestoneId || undefined,
				priority: payloadPriority,
				assigneeIds: form.assigneeIds,
				assigneeGroupIds: form.assigneeGroupIds,
				customFields: form.customFields,
				linkedIssues: form.linkedIssues,
				reason: form.reason || undefined,
			});
			if (columnChanged) {
				await mover.requestMove(issue.id, issue.columnKey, form.columnKey, form.reason || undefined);
				// If a comment is required, the modal will open and onSaved will be triggered after submit.
				if (mover.pendingMove) {
					setSaving(false);
					return;
				}
			}
		}
		setSaving(false);
		await onSaved();
	};

	return (
		<adc-modal ref={modalRef} open modalTitle={isNew ? t("issues.newIssue") : `${issue?.key} · ${t("common.edit")}`} size="xl">
			<div className="p-4 space-y-4">
				{/* Título arriba de todo */}
				<div>
					<label className="block text-sm font-medium mb-1 text-text">{t("issues.issueTitle")}</label>
					<adc-input value={form.title} onInput={(e: any) => setForm({ ...form, title: e.target.value })} disabled={!canEdit} />
				</div>

				{/* Cuerpo: descripción 70% / metadatos 30% */}
				<div className="grid grid-cols-1 lg:grid-cols-[7fr_3fr] gap-4">
					{/* Columna izquierda: descripción */}
					<div className="min-w-0">
						<label className="block text-sm font-medium mb-1 text-text">{t("common.description")}</label>
						{hasUnsavedDraft && !descEditing && (
							<button
								type="button"
								className="w-full text-left mb-2 px-3 py-2 rounded-md border border-warning bg-warning/10 text-warning text-sm hover:bg-warning/15 cursor-pointer"
								onClick={() => {
									if (draftDescription) {
										setForm((prev) => ({ ...prev, description: draftDescription }));
										setDescAttachmentIds(draftAttachmentIds);
									}
									setDescEditing(true);
								}}
							>
								{t("issues.descriptionUnsavedChanges") ?? "Tienes cambios sin guardar — clic para retomar"}
							</button>
						)}
						{descEditing ? (
							<adc-blocks-form
								placeholder={t("issues.descriptionPlaceholder") ?? "Describe el issue con bloques..."}
								initialBlocks={form.description as StencilBlock[]}
								initialAttachmentIds={descAttachmentIds}
								attachmentUrls={descAttachmentUrls}
								disabled={!canEdit}
								submitLabel={t("common.save") ?? "Guardar"}
								showCancel
								onadcCancel={() => {
									// Cancelar descarta el draft (local + backend) y vuelve a la
									// vista renderizada con la última descripción guardada.
									setForm((prev) => ({ ...prev, description: savedDescription }));
									setDraftDescription(null);
									setDraftAttachmentIds([]);
									setHasUnsavedDraft(false);
									setDescEditing(false);
									if (issue) void pmApi.deleteIssueDescriptionDraft(issue.id);
								}}
								onadcSubmit={async (ev) => {
									const d = ev.detail;
									const nextBlocks = (d.blocks as Block[]) ?? [];
									if (issue) {
										setSaving(true);
										const r = await pmApi.updateIssue(issue.id, { description: nextBlocks });
										setSaving(false);
										if (!r.success) return;
									}
									setSavedDescription(nextBlocks);
									setForm((prev) => ({ ...prev, description: nextBlocks }));
									setDescAttachmentIds(d.attachmentIds);
									setDraftDescription(null);
									setHasUnsavedDraft(false);
									setDescEditing(false);
									if (issue) {
										void pmApi.deleteIssueDescriptionDraft(issue.id);
										await onSaved();
									}
								}}
								onadcDraftChange={(ev) => {
									const d = ev.detail;
									const nextBlocks = (d.blocks as Block[]) ?? [];
									setForm((prev) => ({ ...prev, description: nextBlocks }));
									setDescAttachmentIds(d.attachmentIds);
									if (!issue) return;
									if (nextBlocks.length === 0 && d.attachmentIds.length === 0) {
										setHasUnsavedDraft(false);
										setDraftDescription(null);
										void pmApi.deleteIssueDescriptionDraft(issue.id);
									} else {
										setHasUnsavedDraft(true);
										setDraftDescription(nextBlocks);
										setDraftAttachmentIds(d.attachmentIds);
										void pmApi.saveIssueDescriptionDraft(issue.id, {
											blocks: nextBlocks,
											attachmentIds: d.attachmentIds,
										});
									}
								}}
								onadcRequestAttachment={(ev: CustomEvent<{ kind: "image" | "file" }>) => {
									if (!issue) return;
									const kind = ev.detail.kind;
									const input = globalThis.document.createElement("input");
									input.type = "file";
									if (kind === "image") input.accept = "image/*";
									input.onchange = async () => {
										const file = input.files?.[0];
										if (!file) return;
										const presignRes = await pmApi.presignIssueAttachment(issue.id, {
											fileName: file.name,
											mimeType: file.type || "application/octet-stream",
											size: file.size,
											forComment: false,
										});
										if (!presignRes.success || !presignRes.data) return;
										const presign = presignRes.data;
										const putRes = await fetch(presign.uploadUrl, { method: "PUT", body: file, headers: presign.headers });
										if (!putRes.ok) return;
										const confirm = await pmApi.confirmIssueAttachment(issue.id, presign.attachmentId);
										if (!confirm.success || !confirm.data) return;
										const att = confirm.data;
										const dl = await pmApi.getIssueAttachmentDownloadUrl(issue.id, att.id, { inline: true });
										if (dl.success && dl.data?.url) {
											setDescAttachmentUrls((prev) => ({ ...prev, [att.id]: dl.data!.url }));
										}
										const newBlock: Block = {
											type: "attachment",
											kind,
											attachmentId: att.id,
											fileName: att.fileName,
											mimeType: att.mimeType,
											size: att.size,
										};
										setForm((prev) => ({ ...prev, description: [...prev.description, newBlock] }));
										setDescAttachmentIds((prev) => [...prev, att.id]);
									};
									input.click();
								}}
							/>
						) : (
							<button
								type="button"
								className={`w-full text-left rounded-md border border-text/15 bg-surface p-3 min-h-12 ${canEdit ? "cursor-text hover:border-primary/60" : "cursor-default"}`}
								onClick={() => {
									if (!canEdit) return;
									// Entrar en edici\u00f3n desde el render: el buffer arranca con lo guardado.
									setForm((prev) => ({ ...prev, description: savedDescription }));
									setDescEditing(true);
								}}
								title={canEdit ? (t("issues.descriptionClickToEdit") ?? "Clic para editar") : undefined}
							>
								{savedDescription.length === 0 ? (
									<span className="text-muted text-sm italic">{t("issues.descriptionEmpty") ?? "Sin descripci\u00f3n"}</span>
								) : (
									<adc-blocks-renderer blocks={savedDescription as StencilBlock[]} attachmentUrls={descAttachmentUrls} />
								)}
							</button>
						)}
					</div>
					{/* Columna derecha: metadatos (30%) */}
					<aside className="space-y-3 lg:border-l lg:border-border lg:pl-4 min-w-0">
						<div className="grid grid-cols-3 gap-2">
							<div>
								<label className="block text-sm font-medium mb-1 text-text">{t("issues.urgency")}</label>
								<adc-input
									type="number"
									value={String(form.urgency)}
									onInput={(e: any) => setForm({ ...form, urgency: Number(e.target.value) })}
									disabled={!canEdit}
								/>
							</div>
							<div>
								<label className="block text-sm font-medium mb-1 text-text">{t("issues.impact")}</label>
								<adc-input
									type="number"
									value={String(form.importance)}
									onInput={(e: any) => setForm({ ...form, importance: Number(e.target.value) })}
									disabled={!canEdit}
								/>
							</div>
							<div>
								<label className="block text-sm font-medium mb-1 text-text">{t("issues.difficulty")}</label>
								<adc-input
									type="number"
									value={String(form.difficulty)}
									onInput={(e: any) => setForm({ ...form, difficulty: Number(e.target.value) })}
									disabled={!canEdit}
								/>
							</div>
						</div>
						<div>
							<label className="block text-sm font-medium mb-1 text-text">{t("issues.column")}</label>
							<adc-combobox
								value={form.columnKey}
								clearable={false}
								options={JSON.stringify(project.kanbanColumns.map((c) => ({ label: c.name, value: c.key })))}
								onadcChange={(e: any) => setForm({ ...form, columnKey: e.detail })}
								disabled={!canEdit}
							/>
						</div>
						<div className="grid grid-cols-1 gap-2">
							<div>
								<label className="block text-sm font-medium mb-1 text-text">{t("issues.sprint")}</label>
								<adc-combobox
									value={form.sprintId}
									placeholder={t("issues.unassigned")}
									options={JSON.stringify(sprints.map((s) => ({ label: s.name, value: s.id })))}
									onadcChange={(e: any) => setForm({ ...form, sprintId: e.detail })}
									disabled={!canEdit}
								/>
							</div>
							<div>
								<label className="block text-sm font-medium mb-1 text-text">{t("issues.milestone")}</label>
								<adc-combobox
									value={form.milestoneId}
									placeholder={t("issues.unassigned")}
									options={JSON.stringify(milestones.map((m) => ({ label: m.name, value: m.id })))}
									onadcChange={(e: any) => setForm({ ...form, milestoneId: e.detail })}
									disabled={!canEdit}
								/>
							</div>
						</div>
						<UserPicker
							label={t("issues.assignees")}
							selectedIds={form.assigneeIds}
							onChange={(ids) => setForm({ ...form, assigneeIds: ids })}
							disabled={!canEdit}
							initialCache={issue?.assigneeProfiles}
						/>
						<GroupPicker
							label={t("issues.assigneeGroups")}
							selectedIds={form.assigneeGroupIds}
							orgId={project.orgId}
							onChange={(ids) => setForm({ ...form, assigneeGroupIds: ids })}
							disabled={!canEdit}
							resolvedById={issue?.assigneeGroupProfiles}
						/>
						<CustomFieldsEditor
							defs={project.customFieldDefs}
							values={form.customFields}
							onChange={(values) => setForm({ ...form, customFields: values })}
							disabled={!canEdit}
						/>
						{project.issueLinkTypes.length > 0 && (
							<div>
								<label className="block text-sm font-medium mb-1 text-text">{t("issues.links")}</label>
								<IssueLinksEditor
									linkTypes={project.issueLinkTypes}
									currentIssueId={issue?.id}
									allIssues={projectIssues}
									value={form.linkedIssues}
									onChange={(links) => setForm({ ...form, linkedIssues: links })}
									disabled={!canEdit}
								/>
							</div>
						)}
						{!isNew && canEdit && (
							<div>
								<label className="block text-sm font-medium mb-1 text-text">{t("issues.reason")}</label>
								<adc-input value={form.reason} onInput={(e: any) => setForm({ ...form, reason: e.target.value })} />
							</div>
						)}
					</aside>
				</div>

				{/* Acciones de guardado */}
				{canEdit && (
					<div className="flex gap-2 justify-end pt-2 border-t border-text/15">
						<adc-button variant="primary" onClick={save} disabled={saving || !form.title}>
							{saving ? t("common.saving") : t("common.save")}
						</adc-button>
					</div>
				)}

				{/* Tabs inferiores: Comentarios (default) | Historial */}
				{!isNew && issue && (
					<div className="pt-2">
						<div className="flex gap-2 border-b border-border">
							<button
								type="button"
								className={`px-3 py-1.5 text-sm border-b-2 -mb-px ${bottomTab === "comments" ? "border-primary text-text" : "border-transparent text-muted"}`}
								onClick={() => setBottomTab("comments")}
							>
								{t("issues.comments") ?? "Comentarios"}
							</button>
							<button
								type="button"
								className={`px-3 py-1.5 text-sm border-b-2 -mb-px ${bottomTab === "history" ? "border-primary text-text" : "border-transparent text-muted"}`}
								onClick={() => setBottomTab("history")}
							>
								{t("issues.history")} ({history.length})
							</button>
						</div>
						<div className="pt-3">
							{bottomTab === "comments" ? (
								<IssueComments issueId={issue.id} caller={caller} />
							) : (
								<ul className="rounded p-2 max-h-80 overflow-auto text-xs space-y-1">
									{history.map((h, idx) => (
										<li key={`history-${idx}`} className="border-b border-text/15 pb-1">
											<span className="font-mono text-muted">{new Date(h.at).toLocaleString()}</span>{" "}
											<span className="font-semibold">{h.field}</span>:{" "}
											<span className="text-muted">{JSON.stringify(h.oldValue)}</span> →{" "}
											<span>{JSON.stringify(h.newValue)}</span>
											{h.reason && <span className="block text-muted italic">“{h.reason}”</span>}
										</li>
									))}
									{history.length === 0 && <li className="text-muted">—</li>}
								</ul>
							)}
						</div>
					</div>
				)}
			</div>
			<TransitionCommentModal
				open={!!mover.pendingMove}
				submitting={mover.moving}
				fromColumn={mover.pendingMove ? project.kanbanColumns.find((c) => c.key === mover.pendingMove?.fromColumn)?.name : undefined}
				toColumn={mover.pendingMove ? project.kanbanColumns.find((c) => c.key === mover.pendingMove?.toColumn)?.name : undefined}
				onCancel={() => mover.cancelMove()}
				onSubmit={(detail: TransitionCommentSubmitDetail) => {
					void mover.confirmMoveWithComment(detail);
				}}
			/>
		</adc-modal>
	);
}
