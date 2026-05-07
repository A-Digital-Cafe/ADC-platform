import { useTranslation } from "@ui-library/utils/i18n-react";
import type { Project, ProjectVisibility } from "@common/types/project-manager/Project.ts";

const visibilityColor: Record<ProjectVisibility, "green" | "indigo" | "gray"> = {
	public: "green",
	org: "indigo",
	private: "gray",
};

interface Props {
	project: Project;
	canDelete: boolean;
	onOpen: (project: Project) => void;
	onDelete?: (id: string) => void;
}

export function ProjectCard({ project, canDelete, onOpen, onDelete }: Readonly<Props>) {
	const { t } = useTranslation({ namespace: "adc-project-manager" });
	return (
		<adc-card class="p-4 flex flex-col gap-2">
			<div className="flex justify-between items-start gap-2">
				<div>
					<h3 className="font-heading text-lg font-semibold text-text">{project.name}</h3>
					<p className="text-xs text-muted font-mono">{project.slug}</p>
				</div>
				<adc-badge color={visibilityColor[project.visibility]} size="sm">
					{t(`projects.${project.visibility}`)}
				</adc-badge>
			</div>
			{project.description && <p className="text-sm text-muted line-clamp-2">{project.description}</p>}
			<div className="flex flex-wrap gap-2 text-xs">
				<adc-badge color="gray" size="sm">
					{t("projects.issueCounter")}: {project.issueCounter}
				</adc-badge>
			</div>
			<div className="flex gap-2 mt-auto pt-2">
				<adc-button variant="accent" onClick={() => onOpen(project)}>
					{t("common.open")}
				</adc-button>
				{canDelete && onDelete && (
					<adc-button variant="accent" onClick={() => onDelete(project.id)}>
						{t("common.delete")}
					</adc-button>
				)}
			</div>
		</adc-card>
	);
}
