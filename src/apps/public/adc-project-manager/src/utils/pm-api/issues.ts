import type { Project } from "@common/types/project-manager/Project.ts";
import type { Issue } from "@common/types/project-manager/Issue.ts";
import type { UpdateLogEntry } from "@common/types/project-manager/UpdateLogEntry.ts";
import type { Block } from "@common/ADC/types/learning.ts";
import { api, type IssueListParams } from "./client.ts";

export const issuesApi = {
	listIssues: (projectId: string, params?: IssueListParams) =>
		api.get<{ issues: Issue[]; project: Project }>(`/projects/${projectId}/issues`, params ? { params } : undefined),
	createIssue: (projectId: string, data: Partial<Issue> & { title: string }) =>
		api.post<Issue>(`/projects/${projectId}/issues`, { body: data, idempotencyData: { projectId, ...data } }),
	getIssue: (id: string) => api.get<Issue>(`/issues/${id}`),
	updateIssue: (id: string, data: Partial<Issue> & { reason?: string }) =>
		api.put<Issue>(`/issues/${id}`, { body: data, idempotencyData: { issueId: id, data } }),
	deleteIssue: (id: string) => api.delete(`/issues/${id}`, { idempotencyKey: id }),
	moveIssue: (id: string, columnKey: string, opts: { reason?: string; commentBlocks?: Block[]; commentAttachmentIds?: string[] } = {}) =>
		api.post<Issue>(`/issues/${id}/move`, {
			body: { columnKey, ...opts },
			idempotencyData: { issueId: id, columnKey, ...opts },
		}),
	getIssueHistory: (id: string) => api.get<{ updateLog: UpdateLogEntry[] }>(`/issues/${id}/history`),
};
