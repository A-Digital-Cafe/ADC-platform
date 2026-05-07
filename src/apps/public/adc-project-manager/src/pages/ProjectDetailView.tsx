import { useEffect, useRef, useCallback, useState } from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";
import { router } from "@common/utils/router";
import type { Permission } from "@common/types/identity/Permission.ts";
import type { Project } from "@common/types/project-manager/Project.ts";
import { getVisibleProjectTabs } from "../utils/permissions.ts";
import { pmApi } from "../utils/pm-api.ts";
import { BacklogView } from "./BacklogView.tsx";
import { BoardView } from "./BoardView.tsx";
import { CalendarView } from "./CalendarView.tsx";
import { SprintsView } from "./SprintsView.tsx";
import { MilestonesView } from "./MilestonesView.tsx";
import { ProjectSettingsView } from "./ProjectSettingsView.tsx";

interface Props {
	project: Project;
	orgSlug: string;
	perms: Permission[];
	caller?: { userId: string; groupIds: string[] };
	activeTab: string;
	onBack: () => void;
}

export function ProjectDetailView({ project, orgSlug, perms, caller, activeTab, onBack }: Readonly<Props>) {
	const { t } = useTranslation({ namespace: "adc-project-manager" });
	const [currentProject, setCurrentProject] = useState<Project>(project);
	const visibleTabs = getVisibleProjectTabs(perms, currentProject, caller);
	const tabItems = visibleTabs.map((tab) => ({ id: tab.id, label: t(`tabs.${tab.label}`) }));

	// Sincroniza cuando cambia el prop (ej. reselección desde ProjectListView)
	useEffect(() => setCurrentProject(project), [project]);

	const reloadProject = useCallback(async () => {
		const res = await pmApi.getProject(project.id);
		if (res.success && res.data) setCurrentProject(res.data);
	}, [project.id]);

	const tabsRef = useRef<HTMLElement>(null);
	const breadcrumbRef = useRef<HTMLElement>(null);
	const handleTabChange = useCallback(
		(tabId: string) => {
			router.navigate(`/${orgSlug}/${currentProject.slug}/${tabId}`);
		},
		[orgSlug, currentProject.slug]
	);

	useEffect(() => {
		const el = tabsRef.current;
		if (!el) return;
		const handler = (e: Event) => handleTabChange((e as CustomEvent<string>).detail);
		el.addEventListener("adcTabChange", handler);
		return () => el.removeEventListener("adcTabChange", handler);
	});

	useEffect(() => {
		const el = breadcrumbRef.current;
		if (!el) return;
		const handler = () => onBack();
		el.addEventListener("adcBack", handler);
		return () => el.removeEventListener("adcBack", handler);
	}, [onBack]);

	const renderTab = () => {
		switch (activeTab) {
			case "board":
				return <BoardView project={currentProject} perms={perms} caller={caller} />;
			case "backlog":
				return <BacklogView project={currentProject} perms={perms} caller={caller} />;
			case "calendar":
				return <CalendarView project={currentProject} perms={perms} />;
			case "sprints":
				return <SprintsView project={currentProject} perms={perms} caller={caller} />;
			case "milestones":
				return <MilestonesView project={currentProject} perms={perms} caller={caller} />;
			case "settings":
				return <ProjectSettingsView project={currentProject} perms={perms} caller={caller} onChanged={reloadProject} />;
			default:
				return <BoardView project={currentProject} perms={perms} caller={caller} />;
		}
	};

	const breadcrumbItems = JSON.stringify([{ label: t("common.title"), href: "/" }, { label: currentProject.name }]);

	return (
		<div className="space-y-6">
			<adc-top-breadcrumb ref={breadcrumbRef} items={breadcrumbItems} back-label={t("common.back")} />
			{visibleTabs.length > 1 && <adc-tabs ref={tabsRef} tabs={JSON.stringify(tabItems)} activeTab={activeTab} variant="underline" />}
			<div className={activeTab === "settings" ? "" : "mt-4"}>{renderTab()}</div>
		</div>
	);
}
