import type { Project, KanbanColumn, ProjectSettings, PriorityStrategy } from "@common/types/project-manager/Project.ts";
import type { CustomFieldDef } from "@common/types/project-manager/CustomField.ts";
import type { IssueLinkType } from "@common/types/project-manager/IssueLink.ts";
import { api } from "./client.ts";

type CreateProjectInput = {
	name: string;
	slug: string;
	description?: string;
	orgId?: string | null;
	ownerId?: string;
	visibility?: Project["visibility"];
	memberUserIds?: string[];
	memberGroupIds?: string[];
	kanbanColumns?: KanbanColumn[];
	settings?: Partial<ProjectSettings>;
};

export const projectsApi = {
	listProjects: () => api.get<{ projects: Project[] }>("/projects"),
	checkProjectSlug: (orgSlug: string, projectSlug: string) =>
		api.get<{ available: boolean }>(`/projects/check-slug/${orgSlug}/${projectSlug}`),
	getProjectBySlug: (orgSlug: string, projectSlug: string) => api.get<Project>(`/projects/by-slug/${orgSlug}/${projectSlug}`),
	createProject: (data: CreateProjectInput) => api.post<Project>("/projects", { body: data, idempotencyData: data }),
	getProject: (id: string) => api.get<Project>(`/projects/${id}`),
	updateProject: (id: string, data: Partial<Project>) =>
		api.put<Project>(`/projects/${id}`, { body: data, idempotencyData: { projectId: id, data } }),
	deleteProject: (id: string) => api.delete(`/projects/${id}`, { idempotencyKey: id }),

	updateMembers: (id: string, memberUserIds: string[], memberGroupIds: string[]) =>
		api.put<Project>(`/projects/${id}/members`, {
			body: { memberUserIds, memberGroupIds },
			idempotencyData: { projectId: id, memberUserIds, memberGroupIds },
		}),
	updateColumns: (id: string, kanbanColumns: KanbanColumn[]) =>
		api.put<Project>(`/projects/${id}/columns`, {
			body: { kanbanColumns },
			idempotencyData: { projectId: id, kanbanColumns },
		}),
	updateCustomFields: (id: string, customFieldDefs: CustomFieldDef[]) =>
		api.put<Project>(`/projects/${id}/custom-fields`, {
			body: { customFieldDefs },
			idempotencyData: { projectId: id, customFieldDefs },
		}),
	updateLinkTypes: (id: string, issueLinkTypes: IssueLinkType[]) =>
		api.put<Project>(`/projects/${id}/link-types`, {
			body: { issueLinkTypes },
			idempotencyData: { projectId: id, issueLinkTypes },
		}),
	updatePriorityStrategy: (id: string, priorityStrategy: PriorityStrategy) =>
		api.put<Project>(`/projects/${id}/priority-strategy`, {
			body: { priorityStrategy },
			idempotencyData: { projectId: id, priorityStrategy },
		}),
	updateSettings: (id: string, settings: ProjectSettings) =>
		api.put<Project>(`/projects/${id}/settings`, { body: { settings }, idempotencyData: { projectId: id, settings } }),
};
