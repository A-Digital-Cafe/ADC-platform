import { useState } from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";
import type { Project, ProjectSettings } from "@common/types/project-manager/Project.ts";
import { pmApi } from "../../utils/pm-api.ts";

interface Props {
	project: Project;
	canEdit: boolean;
	onSaved: () => void | Promise<void>;
}

export function WipLimitsSection({ project, canEdit, onSaved }: Readonly<Props>) {
	const { t } = useTranslation({ namespace: "adc-project-manager" });
	const [limits, setLimits] = useState<Record<string, number> | undefined>(project.settings?.wipLimits ?? {});
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const set = (key: string, v: number) => {
		const next = { ...limits };
		if (v > 0) next[key] = v;
		else delete next[key];
		setLimits(next);
	};

	const save = async () => {
		setSaving(true);
		setError(null);
		const settings: ProjectSettings = { ...project.settings, wipLimits: limits };
		const res = await pmApi.updateSettings(project.id, settings);
		setSaving(false);
		if (!res.success) {
			setError(res.errorKey ?? "error");
			return;
		}
		await onSaved();
	};

	return (
		<div className="space-y-3 max-w-xl">
			<p className="text-xs text-muted">{t("settings.wipHint")}</p>
			<ul className="space-y-1">
				{project.kanbanColumns
					.slice()
					.sort((a, b) => a.order - b.order)
					.map((c) => (
						<li key={c.id} className="flex items-center gap-2">
							<span className="flex-1 text-sm">{c.name}</span>
							<adc-input
								type="number"
								value={limits?.[c.key] === undefined ? "" : String(limits[c.key])}
								placeholder="∞"
								onInput={(e: any) => set(c.key, Number(e.target.value) || 0)}
								disabled={!canEdit}
							/>
						</li>
					))}
			</ul>
			{error && <p className="text-sm text-tdanger">{error}</p>}
			{canEdit && (
				<adc-button variant="primary" onClick={save} disabled={saving}>
					{t("common.save")}
				</adc-button>
			)}
		</div>
	);
}
