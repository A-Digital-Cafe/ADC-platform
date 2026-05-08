import { useState } from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";
import type { Project } from "@common/types/project-manager/Project.ts";
import { pmApi } from "../../utils/pm-api.ts";
import { UserPicker } from "../pickers/UserPicker.tsx";
import { GroupPicker } from "../pickers/GroupPicker.tsx";

interface Props {
	project: Project;
	canEdit: boolean;
	onSaved: () => void | Promise<void>;
}

export function MembersSection({ project, canEdit, onSaved }: Readonly<Props>) {
	const { t } = useTranslation({ namespace: "adc-project-manager" });
	const [users, setUsers] = useState(project.memberUserIds);
	const [groups, setGroups] = useState(project.memberGroupIds);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const save = async () => {
		setSaving(true);
		setError(null);
		const res = await pmApi.updateMembers(project.id, users, groups);
		setSaving(false);
		if (!res.success) {
			setError(res.errorKey ?? "error");
			return;
		}
		await onSaved();
	};

	return (
		<div className="space-y-4 max-w-xl">
			<UserPicker label={t("settings.memberUsers")} selectedIds={users} onChange={setUsers} disabled={!canEdit} />
			<GroupPicker
				label={t("settings.memberGroups")}
				selectedIds={groups}
				orgId={project.orgId}
				onChange={setGroups}
				disabled={!canEdit}
			/>
			{error && <p className="text-sm text-tdanger">{error}</p>}
			{canEdit && (
				<adc-button variant="primary" onClick={save} disabled={saving}>
					{t("common.save")}
				</adc-button>
			)}
		</div>
	);
}
