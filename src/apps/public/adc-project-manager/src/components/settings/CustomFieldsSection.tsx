import { useState } from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";
import type { Project } from "@common/types/project-manager/Project.ts";
import type { BadgeOption, CustomFieldDef, CustomFieldType } from "@common/types/project-manager/CustomField.ts";
import { LABEL_COLORS } from "@common/types/project-manager/LabelColors.ts";
import { shortId } from "../../utils/ids.ts";
import { pmApi } from "../../utils/pm-api.ts";

interface Props {
	project: Project;
	canEdit: boolean;
	onSaved: () => void | Promise<void>;
}

const FIELD_TYPES: CustomFieldType[] = ["text", "number", "date", "label", "badge", "user"];

export function CustomFieldsSection({ project, canEdit, onSaved }: Readonly<Props>) {
	const { t } = useTranslation({ namespace: "adc-project-manager" });
	const [defs, setDefs] = useState<CustomFieldDef[]>(project.customFieldDefs);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const update = (id: string, patch: Partial<CustomFieldDef>) => setDefs((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
	const add = () => setDefs((prev) => [...prev, { id: shortId(), name: t("settings.newField"), type: "text" }]);
	const remove = (id: string) => setDefs((prev) => prev.filter((d) => d.id !== id));

	const updateBadgeOption = (fieldId: string, index: number, patch: Partial<BadgeOption>) =>
		setDefs((prev) =>
			prev.map((d) => {
				if (d.id !== fieldId) return d;
				const next = [...(d.badgeOptions ?? [])];
				next[index] = { ...next[index], ...patch };
				return { ...d, badgeOptions: next };
			})
		);
	const addBadgeOption = (fieldId: string) =>
		setDefs((prev) =>
			prev.map((d) =>
				d.id === fieldId
					? {
							...d,
							badgeOptions: [...(d.badgeOptions ?? []), { name: t("settings.newBadgeOption"), color: "blue" }],
						}
					: d
			)
		);
	const removeBadgeOption = (fieldId: string, index: number) =>
		setDefs((prev) =>
			prev.map((d) => (d.id === fieldId ? { ...d, badgeOptions: (d.badgeOptions ?? []).filter((_, i) => i !== index) } : d))
		);

	const save = async () => {
		// Validación cliente
		for (const d of defs) {
			if (d.type === "label" && (!d.options || d.options.length === 0)) {
				setError(t("settings.errors.labelNeedsOptions", { name: d.name }));
				return;
			}
			if (d.type === "badge" && (!d.badgeOptions || d.badgeOptions.length === 0)) {
				setError(t("settings.errors.badgeNeedsOptions", { name: d.name }));
				return;
			}
		}
		setSaving(true);
		setError(null);
		const res = await pmApi.updateCustomFields(project.id, defs);
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
				{defs.map((d) => (
					<li key={d.id} className="p-2 border border-border rounded-md bg-surface space-y-2">
						<div className="flex items-center gap-2">
							<adc-input value={d.name} onInput={(e: any) => update(d.id, { name: e.target.value })} disabled={!canEdit} />
							<adc-combobox
								value={d.type}
								clearable={false}
								options={JSON.stringify(FIELD_TYPES.map((x) => ({ label: t(`customFields.type_${x}`), value: x })))}
								onadcChange={(e: any) => update(d.id, { type: e.detail as CustomFieldType })}
								disabled={!canEdit}
							/>
							<label className="flex items-center gap-1 text-xs whitespace-nowrap">
								<input
									type="checkbox"
									checked={!!d.required}
									onChange={(e) => update(d.id, { required: e.target.checked })}
									disabled={!canEdit}
								/>
								{t("settings.required")}
							</label>
							<button
								type="button"
								onClick={() => remove(d.id)}
								disabled={!canEdit}
								className="ml-auto text-tdanger font-bold text-sm disabled:opacity-30"
								aria-label={t("common.delete")}
							>
								×
							</button>
						</div>
						{d.type === "label" && (
							<div>
								<label className="block text-xs mb-1 text-muted">{t("settings.options")}</label>
								<adc-input
									value={(d.options ?? []).join(", ")}
									placeholder="option1, option2, option3"
									onInput={(e: any) =>
										update(d.id, {
											options: e.target.value
												.split(",")
												.map((s: string) => s.trim())
												.filter(Boolean),
										})
									}
									disabled={!canEdit}
								/>
							</div>
						)}
						{d.type === "badge" && (
							<div className="space-y-2">
								<label className="block text-xs text-muted">{t("settings.badgeOptions")}</label>
								<ul className="space-y-1.5">
									{(d.badgeOptions ?? []).map((opt, idx) => (
										<li
											key={"opt" + idx}
											className="flex items-center gap-2 p-1.5 border border-border rounded-md bg-surface"
										>
											<adc-input
												value={opt.name}
												onInput={(e: any) => updateBadgeOption(d.id, idx, { name: e.target.value })}
												disabled={!canEdit}
											/>
											<div className="flex flex-wrap gap-1">
												{LABEL_COLORS.map((c) => (
													<button
														key={c}
														type="button"
														disabled={!canEdit}
														onClick={() => updateBadgeOption(d.id, idx, { color: c })}
														className={`rounded-full ${opt.color === c ? "ring-2 ring-primary" : ""}`}
													>
														<adc-color-label color={c} size="xs">
															{c}
														</adc-color-label>
													</button>
												))}
											</div>
											<button
												type="button"
												onClick={() => removeBadgeOption(d.id, idx)}
												disabled={!canEdit}
												className="ml-auto text-tdanger font-bold text-sm disabled:opacity-30"
												aria-label={t("common.delete")}
											>
												x
											</button>
										</li>
									))}
								</ul>
								{canEdit && (
									<adc-button variant="accent" onClick={() => addBadgeOption(d.id)}>
										{t("settings.addBadgeOption")}
									</adc-button>
								)}
							</div>
						)}
					</li>
				))}
			</ul>
			{canEdit && (
				<div className="flex gap-2">
					<adc-button variant="accent" onClick={add}>
						{t("settings.addField")}
					</adc-button>
					<adc-button variant="primary" onClick={save} disabled={saving}>
						{saving ? t("common.saving") : t("common.save")}
					</adc-button>
				</div>
			)}
			{error && <p className="text-sm text-tdanger">{error}</p>}
		</div>
	);
}
