import type { Model } from "mongoose";
import type { Issue, IssuePriority } from "@common/types/project-manager/Issue.ts";
import type { ILogger } from "../../../../interfaces/utils/ILogger.js";
import { generateId } from "@common/utils/crypto.ts";
import { type AuthVerifierGetter, PermissionChecker } from "@common/types/auth-verifier.ts";
import { PMScopes, PM_RESOURCE_NAME } from "@common/types/project-manager/permissions.ts";
import { CRUDXAction } from "@common/types/Actions.ts";
import { ProjectManagerError } from "@common/types/custom-errors/ProjectManagerError.ts";
import { formatIssueKey, deriveProjectKey } from "@common/utils/project-manager/keygen.ts";
import { buildDiffEntries } from "@common/utils/project-manager/diff.ts";
import { sortIssuesByPriority, normalizeUrgency, normalizeDifficulty } from "@common/utils/project-manager/priority.ts";
import { isProjectAccessibleInOrgContext, isProjectMember } from "../utils/project-access.ts";
import type { ProjectInternals, CallerMembership } from "./projects.ts";
import type { Project } from "@common/types/project-manager/Project.ts";
import { getPMTierLimits } from "@common/types/project-manager/tier-limits.ts";
import { docToPlain, findByIdAsPlain, projectOwnerAllowIf, stripImmutableFields } from "./shared.ts";

const ISSUE_IMMUTABLE_FIELDS = ["id", "projectId", "key", "createdAt", "reporterId", "updateLog", "attachments"] as const;

export interface IssueListFilters {
	sprintId?: string;
	milestoneId?: string;
	assigneeId?: string;
	columnKey?: string;
	q?: string;
	orderBy?: "priority" | "createdAt" | "updatedAt";
}

function defaultPriority(): IssuePriority {
	return { urgency: 0, importance: 0, difficulty: null };
}

function isAssignee(issue: Issue | null | undefined, userId: string, groupIds: string[]): boolean {
	if (!issue) return false;
	if (issue.assigneeIds?.includes(userId)) return true;
	return issue.assigneeGroupIds?.some((gid) => groupIds.includes(gid)) ?? false;
}

export class IssueManager {
	readonly #permissionChecker: PermissionChecker;

	constructor(
		private readonly issueModel: Model<Issue>,
		private readonly projectInternals: ProjectInternals,
		private readonly logger: ILogger,
		getAuthVerifier: AuthVerifierGetter = () => null
	) {
		this.#permissionChecker = new PermissionChecker(getAuthVerifier, "IssueManager", PM_RESOURCE_NAME);
	}

	async create(project: Project, input: Partial<Issue> & Pick<Issue, "title">, token?: string, caller?: CallerMembership): Promise<Issue> {
		const reporterId = await this.#permissionChecker.requirePermission(token, CRUDXAction.WRITE, PMScopes.ISSUES, {
			ownerId: project.ownerId,
			allowIf: projectOwnerAllowIf(project, caller),
		});

		const { maxIssuesPerProject } = getPMTierLimits();
		const count = await this.issueModel.countDocuments({ projectId: project.id });
		if (count >= maxIssuesPerProject) {
			throw new ProjectManagerError(403, "TIER_LIMIT_REACHED", `Límite de issues por proyecto alcanzado (${maxIssuesPerProject})`);
		}

		const autoColumn = project.kanbanColumns.find((c) => c.isAuto) ?? project.kanbanColumns[0];
		if (!autoColumn) {
			throw new ProjectManagerError(500, "INVALID_COLUMN", "Proyecto sin columna inicial configurada");
		}

		const number = await this.projectInternals.incrementIssueCounter(project.id);
		const prefix = deriveProjectKey(project.slug || project.name);
		const key = formatIssueKey(prefix, number);

		const priority: IssuePriority = input.priority
			? {
					urgency: normalizeUrgency(input.priority.urgency),
					importance: normalizeUrgency(input.priority.importance),
					difficulty: normalizeDifficulty(input.priority.difficulty),
				}
			: defaultPriority();

		const issue: Issue = {
			id: generateId(),
			projectId: project.id,
			key,
			title: input.title,
			description: input.description ?? "",
			columnKey: input.columnKey ?? autoColumn.key,
			category: input.category ?? "task",
			sprintId: input.sprintId,
			milestoneId: input.milestoneId,
			reporterId,
			assigneeIds: input.assigneeIds ?? [],
			assigneeGroupIds: input.assigneeGroupIds ?? [],
			priority,
			storyPoints: input.storyPoints,
			customFields: input.customFields ?? {},
			linkedIssues: input.linkedIssues ?? [],
			updateLog: [],
			createdAt: new Date(),
			updatedAt: new Date(),
		};

		await this.issueModel.create(issue);
		this.logger.logDebug(`Issue ${key} creado en ${project.slug}`);
		return issue;
	}

	async get(issueId: string, token?: string, caller?: CallerMembership): Promise<Issue | null> {
		const issue = await findByIdAsPlain<Issue>(this.issueModel, issueId);
		const project = issue ? await this.projectInternals.fetchProject(issue.projectId) : null;
		const groupIds = caller?.groupIds ?? [];
		const tokenOrgId = caller?.tokenOrgId ?? null;
		// Aislamiento por contexto: si el proyecto es org-scoped y el token no está en esa org,
		// ni membresía ni assignment conceden acceso (hay que switchear primero).
		const inOrgCtx = isProjectAccessibleInOrgContext(project, tokenOrgId);
		await this.#permissionChecker.requirePermission(token, CRUDXAction.READ, PMScopes.ISSUES, {
			ownerId: issue?.reporterId ?? project?.ownerId,
			allowIf: (uid) => inOrgCtx && (isProjectMember(project, { id: uid, groupIds }, tokenOrgId) || isAssignee(issue, uid, groupIds)),
		});
		return issue;
	}

	async list(project: Project, filters: IssueListFilters = {}, token?: string, caller?: CallerMembership): Promise<Issue[]> {
		await this.#permissionChecker.requirePermission(token, CRUDXAction.READ, PMScopes.ISSUES, {
			ownerId: project.ownerId,
			allowIf: (uid) => isProjectMember(project, { id: uid, groupIds: caller?.groupIds ?? [] }, caller?.tokenOrgId ?? null),
		});

		const query: Record<string, unknown> = { projectId: project.id };
		if (filters.sprintId) query.sprintId = filters.sprintId;
		if (filters.milestoneId) query.milestoneId = filters.milestoneId;
		if (filters.columnKey) query.columnKey = filters.columnKey;
		if (filters.assigneeId) query.assigneeIds = filters.assigneeId;
		if (filters.q) query.$text = { $search: filters.q };

		const docs = await this.issueModel.find(query);
		const issues = docs.map((d) => docToPlain<Issue>(d)!);

		if (filters.orderBy === "priority") return sortIssuesByPriority(issues, project.priorityStrategy);
		if (filters.orderBy === "createdAt") return issues.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
		if (filters.orderBy === "updatedAt") return issues.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
		return issues;
	}

	async update(
		issueId: string,
		updates: Partial<Issue>,
		reason: string | undefined,
		token?: string,
		caller?: CallerMembership
	): Promise<Issue> {
		const current = await findByIdAsPlain<Issue>(this.issueModel, issueId);
		if (!current) throw new ProjectManagerError(404, "ISSUE_NOT_FOUND", `Issue ${issueId} no encontrado`);
		const project = await this.projectInternals.fetchProject(current.projectId);

		const groupIds = caller?.groupIds ?? [];
		const tokenOrgId = caller?.tokenOrgId ?? null;
		const inOrgCtx = isProjectAccessibleInOrgContext(project, tokenOrgId);
		// Update: reporter (owner del issue), assignees directos/por grupo, u owner del proyecto.
		const actorId = await this.#permissionChecker.requirePermission(token, CRUDXAction.UPDATE, PMScopes.ISSUES, {
			ownerId: current.reporterId ?? project?.ownerId,
			allowIf: (uid) => inOrgCtx && (current.reporterId === uid || isAssignee(current, uid, groupIds) || project?.ownerId === uid),
		});

		if (updates.priority) {
			updates.priority = {
				urgency: normalizeUrgency(updates.priority.urgency),
				importance: normalizeUrgency(updates.priority.importance),
				difficulty: normalizeDifficulty(updates.priority.difficulty),
			};
		}

		const safe: Partial<Issue> = { ...stripImmutableFields(updates, ISSUE_IMMUTABLE_FIELDS), updatedAt: new Date() };

		const diffEntries = buildDiffEntries(current, safe, actorId || current.reporterId, reason);

		const setOps: Record<string, unknown> = { ...safe };
		const updateDoc: Record<string, unknown> = { $set: setOps };
		if (diffEntries.length) updateDoc.$push = { updateLog: { $each: diffEntries } };

		const updated = await this.issueModel.findOneAndUpdate({ id: issueId }, updateDoc, { new: true });
		if (!updated) throw new ProjectManagerError(404, "ISSUE_NOT_FOUND", `Issue ${issueId} no encontrado`);
		return docToPlain<Issue>(updated)!;
	}

	async delete(issueId: string, token?: string, caller?: CallerMembership): Promise<void> {
		const issue = await findByIdAsPlain<Issue>(this.issueModel, issueId);
		const project = issue ? await this.projectInternals.fetchProject(issue.projectId) : null;
		const tokenOrgId = caller?.tokenOrgId ?? null;
		const inOrgCtx = isProjectAccessibleInOrgContext(project, tokenOrgId);

		await this.#permissionChecker.requirePermission(token, CRUDXAction.DELETE, PMScopes.ISSUES, {
			ownerId: issue?.reporterId ?? project?.ownerId,
			// Delete es restrictivo: owner del proyecto o reporter del issue.
			allowIf: (uid) => inOrgCtx && ((!!project && project.ownerId === uid) || (!!issue && issue.reporterId === uid)),
		});
		if (!issue) throw new ProjectManagerError(404, "ISSUE_NOT_FOUND", `Issue ${issueId} no encontrado`);
		const result = await this.issueModel.deleteOne({ id: issueId });
		if (result.deletedCount === 0) throw new ProjectManagerError(404, "ISSUE_NOT_FOUND", `Issue ${issueId} no encontrado`);
	}

	async move(issueId: string, targetColumnKey: string, reason: string | undefined, token?: string, caller?: CallerMembership): Promise<Issue> {
		const current = await findByIdAsPlain<Issue>(this.issueModel, issueId);
		if (!current) throw new ProjectManagerError(404, "ISSUE_NOT_FOUND", `Issue ${issueId} no encontrado`);
		const project = await this.projectInternals.fetchProject(current.projectId);
		if (!project) throw new ProjectManagerError(404, "PROJECT_NOT_FOUND", `Proyecto ${current.projectId} no encontrado`);

		const groupIds = caller?.groupIds ?? [];
		const tokenOrgId = caller?.tokenOrgId ?? null;
		const inOrgCtx = isProjectAccessibleInOrgContext(project, tokenOrgId);
		// Move: reporter, assignees u owner del proyecto.
		const actorId = await this.#permissionChecker.requirePermission(token, CRUDXAction.UPDATE, PMScopes.ISSUES, {
			ownerId: current.reporterId ?? project.ownerId,
			allowIf: (uid) => inOrgCtx && (current.reporterId === uid || isAssignee(current, uid, groupIds) || project.ownerId === uid),
		});

		const column = project.kanbanColumns.find((c) => c.key === targetColumnKey);
		if (!column) throw new ProjectManagerError(400, "COLUMN_NOT_FOUND", `Columna '${targetColumnKey}' no existe en el proyecto`);

		const wipLimit = project.settings?.wipLimits?.[targetColumnKey];
		if (wipLimit !== undefined) {
			const count = await this.issueModel.countDocuments({ projectId: project.id, columnKey: targetColumnKey });
			if (count >= wipLimit) {
				throw new ProjectManagerError(400, "WIP_LIMIT_REACHED", `Columna '${targetColumnKey}' alcanzó su WIP limit (${wipLimit})`);
			}
		}

		if (current.columnKey === targetColumnKey) return current;

		const patch: Partial<Issue> = { columnKey: targetColumnKey, updatedAt: new Date() };
		if (column.isDone) patch.closedAt = new Date();
		else if (current.closedAt) patch.closedAt = undefined;

		const diff = buildDiffEntries(current, patch, actorId || current.reporterId, reason);

		const updated = await this.issueModel.findOneAndUpdate(
			{ id: issueId },
			{ $set: patch, $push: { updateLog: { $each: diff } } },
			{ new: true }
		);
		if (!updated) throw new ProjectManagerError(404, "ISSUE_NOT_FOUND", `Issue ${issueId} no encontrado`);
		return docToPlain<Issue>(updated)!;
	}
}
