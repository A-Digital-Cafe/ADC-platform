import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";
import type { Permission } from "@common/types/identity/Permission.ts";
import type { Project } from "@common/types/project-manager/Project.ts";
import { canUpdateProjectResource, Scope, type CallerCtx } from "../utils/permissions.ts";
import { GeneralSection } from "../components/settings/GeneralSection.tsx";
import { MembersSection } from "../components/settings/MembersSection.tsx";
import { ColumnsSection } from "../components/settings/ColumnsSection.tsx";
import { CustomFieldsSection } from "../components/settings/CustomFieldsSection.tsx";
import { LinkTypesSection } from "../components/settings/LinkTypesSection.tsx";
import { PrioritySection } from "../components/settings/PrioritySection.tsx";
import { WipLimitsSection } from "../components/settings/WipLimitsSection.tsx";

interface Props {
	project: Project;
	perms: Permission[];
	caller?: CallerCtx;
	onChanged: () => void | Promise<void>;
}

type SettingsTab = "general" | "members" | "columns" | "customFields" | "linkTypes" | "priority" | "wip";

export function ProjectSettingsView({ project, perms, caller, onChanged }: Readonly<Props>) {
	const { t } = useTranslation({ namespace: "adc-project-manager" });
	const [tab, setTab] = useState<SettingsTab>("general");

	const canEditProject = canUpdateProjectResource(perms, Scope.PROJECTS, project, caller);
	const canEditSettings = canUpdateProjectResource(perms, Scope.SETTINGS, project, caller);
	const canEditCustomFields = canUpdateProjectResource(perms, Scope.CUSTOM_FIELDS, project, caller);

	const tabs: Array<{ id: SettingsTab; label: string; enabled: boolean }> = [
		{ id: "general", label: t("settings.generalTab"), enabled: true },
		{ id: "members", label: t("settings.membersTab"), enabled: canEditProject },
		{ id: "columns", label: t("settings.columnsTab"), enabled: canEditSettings },
		{ id: "customFields", label: t("settings.customFieldsTab"), enabled: canEditCustomFields },
		{ id: "linkTypes", label: t("settings.linkTypesTab"), enabled: canEditSettings },
		{ id: "priority", label: t("settings.priorityTab"), enabled: canEditSettings },
		{ id: "wip", label: t("settings.wipTab"), enabled: canEditSettings },
	];

	const tabItems = tabs.map((x) => ({ id: x.id, label: x.label, disabled: !x.enabled }));

	const tabsRef = useRef<HTMLElement>(null);
	const handleTabChange = useCallback((tabId: SettingsTab) => {
		setTab(tabId);
	}, []);

	useEffect(() => {
		const el = tabsRef.current;
		if (!el) return;
		const handler = (e: Event) => handleTabChange((e as CustomEvent<SettingsTab>).detail);
		el.addEventListener("adcTabChange", handler);
		return () => el.removeEventListener("adcTabChange", handler);
	}, [handleTabChange]);

	return (
		<div className="space-y-6">
			<adc-tabs ref={tabsRef} tabs={JSON.stringify(tabItems)} activeTab={tab} variant="underline" />
			<div>
				{tab === "general" && <GeneralSection project={project} canEdit={canEditProject} onSaved={onChanged} />}
				{tab === "members" && <MembersSection project={project} canEdit={canEditProject} onSaved={onChanged} />}
				{tab === "columns" && <ColumnsSection project={project} canEdit={canEditSettings} onSaved={onChanged} />}
				{tab === "customFields" && <CustomFieldsSection project={project} canEdit={canEditCustomFields} onSaved={onChanged} />}
				{tab === "linkTypes" && <LinkTypesSection project={project} canEdit={canEditSettings} onSaved={onChanged} />}
				{tab === "priority" && <PrioritySection project={project} canEdit={canEditSettings} onSaved={onChanged} />}
				{tab === "wip" && <WipLimitsSection project={project} canEdit={canEditSettings} onSaved={onChanged} />}
			</div>
		</div>
	);
}
