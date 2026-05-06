import type { Sprint } from "@common/types/project-manager/Sprint.ts";
import type { Milestone } from "@common/types/project-manager/Milestone.ts";
import { api } from "./client.ts";

export const sprintsApi = {
	listSprints: (projectId: string) => api.get<{ sprints: Sprint[] }>(`/projects/${projectId}/sprints`),
	createSprint: (projectId: string, data: Partial<Sprint> & { name: string }) =>
		api.post<Sprint>(`/projects/${projectId}/sprints`, { body: data, idempotencyData: { projectId, ...data } }),
	updateSprint: (id: string, data: Partial<Sprint>) =>
		api.put<Sprint>(`/sprints/${id}`, { body: data, idempotencyData: { sprintId: id, data } }),
	deleteSprint: (id: string) => api.delete(`/sprints/${id}`, { idempotencyKey: id }),
	startSprint: (id: string) => api.post<Sprint>(`/sprints/${id}/start`, { idempotencyKey: `start:${id}` }),
	completeSprint: (id: string) => api.post<Sprint>(`/sprints/${id}/complete`, { idempotencyKey: `complete:${id}` }),
};

export const milestonesApi = {
	listMilestones: (projectId: string) => api.get<{ milestones: Milestone[] }>(`/projects/${projectId}/milestones`),
	createMilestone: (projectId: string, data: Partial<Milestone> & { name: string }) =>
		api.post<Milestone>(`/projects/${projectId}/milestones`, { body: data, idempotencyData: { projectId, ...data } }),
	updateMilestone: (id: string, data: Partial<Milestone>) =>
		api.put<Milestone>(`/milestones/${id}`, { body: data, idempotencyData: { milestoneId: id, data } }),
	deleteMilestone: (id: string) => api.delete(`/milestones/${id}`, { idempotencyKey: id }),
};
