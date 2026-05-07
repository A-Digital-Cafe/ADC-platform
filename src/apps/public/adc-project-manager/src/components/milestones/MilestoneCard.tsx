import { useState } from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";
import type { Permission } from "@common/types/identity/Permission.ts";
import type { Project } from "@common/types/project-manager/Project.ts";
import type { Milestone, MilestoneStatus } from "@common/types/project-manager/Milestone.ts";
import { canDeleteProjectResource, canUpdateProjectResource, Scope, type CallerCtx } from "../../utils/permissions.ts";
import { pmApi } from "../../utils/pm-api.ts";

interface Props {
	milestone: Milestone;
	doneCount: number;
	totalCount: number;
	perms: Permission[];
	project: Project;
	caller?: CallerCtx;
	onDelete: (id: string) => void;
	onUpdated: () => void | Promise<void>;
}

const STATUS_COLORS: Record<MilestoneStatus, "gray" | "green" | "blue" | "red"> = {
	planned: "gray",
	active: "green",
	completed: "blue",
	cancelled: "red",
};
const STATUSES: MilestoneStatus[] = ["planned", "active", "completed", "cancelled"];

function toDateInput(v?: Date | string): string {
	if (!v) return "";
	const d = v instanceof Date ? v : new Date(v);
	if (Number.isNaN(d.getTime())) return "";
	return d.toISOString().slice(0, 10);
}

export function MilestoneCard({ milestone, doneCount, totalCount, perms, project, caller, onDelete, onUpdated }: Readonly<Props>) {
	const { t } = useTranslation({ namespace: "adc-project-manager" });
	const canEdit = canUpdateProjectResource(perms, Scope.MILESTONES, project, caller);
	const [editing, setEditing] = useState(false);
	const [saving, setSaving] = useState(false);
	const [form, setForm] = useState({
		name: milestone.name,
		description: milestone.description ?? "",
		startDate: toDateInput(milestone.startDate),
		endDate: toDateInput(milestone.endDate),
		status: milestone.status,
	});

	const save = async () => {
		setSaving(true);
		const res = await pmApi.updateMilestone(milestone.id, {
			name: form.name,
			description: form.description || undefined,
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
							options={JSON.stringify(STATUSES.map((s) => ({ label: t(`milestones.${s}`), value: s })))}
							onadcChange={(e: any) => setForm({ ...form, status: e.detail as MilestoneStatus })}
						/>
					</div>
					<div>
						<label className="block text-xs text-muted mb-1">{t("milestones.startDate")}</label>
						<input
							type="date"
							className="w-full border border-border rounded-md px-2 py-1 text-sm bg-surface text-text"
							value={form.startDate}
							onChange={(e) => setForm({ ...form, startDate: e.target.value })}
						/>
					</div>
					<div>
						<label className="block text-xs text-muted mb-1">{t("milestones.endDate")}</label>
						<input
							type="date"
							className="w-full border border-border rounded-md px-2 py-1 text-sm bg-surface text-text"
							value={form.endDate}
							onChange={(e) => setForm({ ...form, endDate: e.target.value })}
						/>
					</div>
				</div>
				<div>
					<label className="block text-xs text-muted mb-1">{t("common.description")}</label>
					<adc-textarea value={form.description} onInput={(e: any) => setForm({ ...form, description: e.target.value })} />
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
				<div className="flex items-center gap-2">
					<h4 className="font-semibold text-text">{milestone.name}</h4>
					<adc-badge color={STATUS_COLORS[milestone.status] ?? "gray"} size="sm">
						{t(`milestones.${milestone.status}`)}
					</adc-badge>
				</div>
				{milestone.description && <p className="text-sm text-muted">{milestone.description}</p>}
				{(milestone.startDate || milestone.endDate) && (
					<p className="text-xs text-muted">
						{toDateInput(milestone.startDate) || "—"} → {toDateInput(milestone.endDate) || "—"}
					</p>
				)}
				<p className="text-xs text-muted">{t("milestones.issuesCount", { done: String(doneCount), total: String(totalCount) })}</p>
			</div>
			<div className="flex items-center gap-2">
				{canEdit && (
					<adc-button variant="accent" onClick={() => setEditing(true)}>
						{t("common.edit")}
					</adc-button>
				)}
				{canDeleteProjectResource(perms, Scope.MILESTONES, project, caller) && (
					<adc-button variant="accent" onClick={() => onDelete(milestone.id)}>
						{t("common.delete")}
					</adc-button>
				)}
			</div>
		</adc-card>
	);
}
