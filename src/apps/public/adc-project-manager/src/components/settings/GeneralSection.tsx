import { useState } from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";
import type { Project, ProjectVisibility } from "@common/types/project-manager/Project.ts";
import { pmApi } from "../../utils/pm-api.ts";

interface Props {
	project: Project;
	canEdit: boolean;
	onSaved: () => void | Promise<void>;
}

const VISIBILITIES: ProjectVisibility[] = ["private", "org", "public"];

export function GeneralSection({ project, canEdit, onSaved }: Readonly<Props>) {
	const { t } = useTranslation({ namespace: "adc-project-manager" });
	const [name, setName] = useState(project.name);
	const [description, setDescription] = useState(project.description ?? "");
	const [visibility, setVisibility] = useState<ProjectVisibility>(project.visibility);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const save = async () => {
		setSaving(true);
		setError(null);
		const res = await pmApi.updateProject(project.id, { name, description, visibility });
		setSaving(false);
		if (!res.success) {
			setError(res.errorKey ?? "error");
			return;
		}
		await onSaved();
	};

	return (
		<div className="space-y-3 max-w-xl">
			<div>
				<label className="block text-sm font-medium text-text mb-1">{t("settings.name")}</label>
				<adc-input value={name} onInput={(e: any) => setName(e.target.value)} disabled={!canEdit} />
			</div>
			<div>
				<label className="block text-sm font-medium text-text mb-1">{t("settings.description")}</label>
				<adc-textarea value={description} onInput={(e: any) => setDescription(e.target.value)} disabled={!canEdit} rows={3} />
			</div>
			<div>
				<label className="block text-sm font-medium text-text mb-1">{t("settings.visibility")}</label>
				<adc-combobox
					value={visibility}
					clearable={false}
					options={JSON.stringify(VISIBILITIES.map((v) => ({ label: t(`settings.visibility_${v}`), value: v })))}
					onadcChange={(e: any) => setVisibility(e.detail as ProjectVisibility)}
					disabled={!canEdit}
				/>
			</div>
			{error && <p className="text-sm text-tdanger">{error}</p>}
			{canEdit && (
				<adc-button variant="primary" onClick={save} disabled={saving}>
					{t("common.save")}
				</adc-button>
			)}
		</div>
	);
}
