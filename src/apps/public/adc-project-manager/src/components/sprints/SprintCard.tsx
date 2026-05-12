import { useState } from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";
import type { Permission } from "@common/types/identity/Permission.ts";
import type { Project } from "@common/types/project-manager/Project.ts";
import type { Sprint, SprintStatus } from "@common/types/project-manager/Sprint.ts";
import { canUpdateProjectResource, canDeleteProjectResource, Scope, type CallerCtx } from "../../utils/permissions.ts";
import { pmApi } from "../../utils/pm-api.ts";

const STATUS_COLORS = { planned: "gray", active: "green", completed: "blue" } as const;
const STATUSES: SprintStatus[] = ["planned", "active", "completed"];

function toDateInput(v?: Date | string): string {
	if (!v) return "";
	const d = v instanceof Date ? v : new Date(v);
	if (Number.isNaN(d.getTime())) return "";
	return d.toISOString().slice(0, 10);
}

interface Props {
	sprint: Sprint;
	doneCount: number;
	totalCount: number;
	perms: Permission[];
	project: Project;
	caller?: CallerCtx;
	onStart: (id: string) => void;
	onComplete: (id: string) => void;
	onDelete: (id: string) => void;
	onUpdated: () => void | Promise<void>;
}

export function SprintCard({
	sprint,
	doneCount,
	totalCount,
	perms,
	project,
	caller,
	onStart,
	onComplete,
	onDelete,
	onUpdated,
}: Readonly<Props>) {
	const { t } = useTranslation({ namespace: "adc-project-manager" });
	const canEdit = canUpdateProjectResource(perms, Scope.SPRINTS, project, caller);
	const [editing, setEditing] = useState(false);
	const [saving, setSaving] = useState(false);
	const [form, setForm] = useState({
		name: sprint.name,
		goal: sprint.goal ?? "",
		startDate: toDateInput(sprint.startDate),
		endDate: toDateInput(sprint.endDate),
		status: sprint.status,
	});

	const save = async () => {
		setSaving(true);
		const res = await pmApi.updateSprint(sprint.id, {
			name: form.name,
			goal: form.goal || undefined,
			startDate: form.startDate ? new Date(form.startDate) : undefined,
			endDate: form.endDate ? new Date(form.endDate) : undefined,
			status: form.status,
		});
		setSaving(false);
		if (res.success) {
			setEditing(false);
			await onUpdated();
		}
	};

	if (editing) {
		return (
			<adc-card key="edit" class="p-4 space-y-2">
				<div className="grid grid-cols-2 gap-2">
					<div>
						<label className="block text-xs text-muted mb-1">{t("common.name")}</label>
						<adc-input value={form.name} onInput={(e: any) => setForm({ ...form, name: e.target.value })} />
					</div>
					<div>
						<label className="block text-xs text-muted mb-1">{t("common.status")}</label>
						<adc-combobox
							value={form.status}
							clearable={false}
							options={JSON.stringify(STATUSES.map((s) => ({ label: t(`sprints.${s}`), value: s })))}
							onadcChange={(e: any) => setForm({ ...form, status: e.detail as SprintStatus })}
						/>
					</div>
					<div>
						<label className="block text-xs text-muted mb-1">{t("sprints.startDate")}</label>
						<input
							type="date"
							className="w-full border border-border rounded-md px-2 py-1 text-sm bg-surface text-text"
							value={form.startDate}
							onChange={(e) => setForm({ ...form, startDate: e.target.value })}
						/>
					</div>
					<div>
						<label className="block text-xs text-muted mb-1">{t("sprints.endDate")}</label>
						<input
							type="date"
							className="w-full border border-border rounded-md px-2 py-1 text-sm bg-surface text-text"
							value={form.endDate}
							onChange={(e) => setForm({ ...form, endDate: e.target.value })}
						/>
					</div>
				</div>
				<div>
					<label className="block text-xs text-muted mb-1">{t("sprints.goal")}</label>
					<adc-textarea value={form.goal} onInput={(e: any) => setForm({ ...form, goal: e.target.value })} />
				</div>
				<div className="flex justify-end gap-2 pt-1">
					<adc-button variant="accent" onClick={() => setEditing(false)} disabled={saving}>
						{t("common.cancel")}
					</adc-button>
					<adc-button variant="primary" onClick={save} disabled={saving || !form.name}>
						{saving ? t("common.saving") : t("common.save")}
					</adc-button>
				</div>
			</adc-card>
		);
	}

	return (
		<adc-card key="view" class="p-4 flex items-center justify-between gap-3">
			<div>
				<h4 className="font-semibold text-text">{sprint.name}</h4>
				{sprint.goal && <p className="text-sm text-muted">{sprint.goal}</p>}
				{(sprint.startDate || sprint.endDate) && (
					<p className="text-xs text-muted">
						{toDateInput(sprint.startDate) || "—"} → {toDateInput(sprint.endDate) || "—"}
					</p>
				)}
				<p className="text-xs text-muted mt-1">{t("sprints.issuesCount", { done: String(doneCount), total: String(totalCount) })}</p>
			</div>
			<div className="flex items-center gap-2">
				<adc-badge color={STATUS_COLORS[sprint.status] ?? "gray"} size="sm">
					{t(`sprints.${sprint.status}`)}
				</adc-badge>
				{canEdit && sprint.status === "planned" && (
					<adc-button variant="accent" onClick={() => onStart(sprint.id)}>
						{t("sprints.start")}
					</adc-button>
				)}
				{canEdit && sprint.status === "active" && (
					<adc-button variant="accent" onClick={() => onComplete(sprint.id)}>
						{t("sprints.complete")}
					</adc-button>
				)}
				{canEdit && (
					<adc-button variant="accent" onClick={() => setEditing(true)}>
						{t("common.edit")}
					</adc-button>
				)}
				{canDeleteProjectResource(perms, Scope.SPRINTS, project, caller) && (
					<adc-button variant="accent" onClick={() => onDelete(sprint.id)}>
						{t("common.delete")}
					</adc-button>
				)}
			</div>
		</adc-card>
	);
}
