import { useState } from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";
import type { Project } from "@common/types/project-manager/Project.ts";
import type { IssueLinkType } from "@common/types/project-manager/IssueLink.ts";
import { LABEL_COLORS, type LabelColor } from "@common/types/project-manager/LabelColors.ts";
import { shortId } from "../../utils/ids.ts";
import { pmApi } from "../../utils/pm-api.ts";

interface Props {
	project: Project;
	canEdit: boolean;
	onSaved: () => void | Promise<void>;
}

export function LinkTypesSection({ project, canEdit, onSaved }: Readonly<Props>) {
	const { t } = useTranslation({ namespace: "adc-project-manager" });
	const [types, setTypes] = useState<IssueLinkType[]>(project.issueLinkTypes);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const update = (id: string, patch: Partial<IssueLinkType>) => setTypes((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
	const add = () =>
		setTypes([...types, { id: shortId(), name: t("settings.newLinkType"), inverseName: t("settings.newLinkTypeInverse"), color: "blue" }]);
	const remove = (id: string) => setTypes(types.filter((l) => l.id !== id));

	const save = async () => {
		setSaving(true);
		setError(null);
		const res = await pmApi.updateLinkTypes(project.id, types);
		setSaving(false);
		if (!res.success) {
			setError(res.errorKey ?? "error");
			return;
		}
		await onSaved();
	};

	return (
		<div className="space-y-3">
			<ul className="space-y-2">
				{types.map((l) => (
					<li key={l.id} className="flex items-center gap-2 p-2 border border-border rounded-md bg-surface">
						<adc-input
							value={l.name}
							placeholder={t("settings.linkName")}
							onInput={(e: any) => update(l.id, { name: e.target.value })}
							disabled={!canEdit}
						/>
						<adc-input
							value={l.inverseName}
							placeholder={t("settings.linkInverseName")}
							onInput={(e: any) => update(l.id, { inverseName: e.target.value })}
							disabled={!canEdit}
						/>
						<adc-combobox
							value={l.color}
							options={JSON.stringify(LABEL_COLORS.map((c) => ({ label: c, value: c })))}
							onadcChange={(e: any) => update(l.id, { color: e.detail as LabelColor })}
							disabled={!canEdit}
						/>
						<button
							type="button"
							onClick={() => remove(l.id)}
							disabled={!canEdit}
							className="ml-auto text-tdanger font-bold text-sm disabled:opacity-30"
							aria-label={t("common.delete")}
						>
							×
						</button>
					</li>
				))}
			</ul>
			{canEdit && (
				<div className="flex gap-2">
					<adc-button variant="accent" onClick={add}>
						{t("settings.addLinkType")}
					</adc-button>
					<adc-button variant="primary" onClick={save} disabled={saving}>
						{t("common.save")}
					</adc-button>
				</div>
			)}
			{error && <p className="text-sm text-tdanger">{error}</p>}
		</div>
	);
}
