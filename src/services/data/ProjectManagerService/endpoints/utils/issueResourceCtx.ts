import type { EndpointCtx } from "../../../../core/EndpointManagerService/index.js";
import { ProjectManagerError } from "@common/types/custom-errors/ProjectManagerError.ts";
import type ProjectManagerService from "../../index.js";
import type { Project } from "@common/types/project-manager/Project.ts";
import type { Issue } from "@common/types/project-manager/Issue.ts";
import type { IssueCommentEndpointCtx } from "../../permissions/issueComments.ts";
import type { IssueAttachmentEndpointCtx } from "../../permissions/issueAttachments.ts";
import { AuthError } from "@common/types/custom-errors/AuthError.ts";
import { resolveUserAvatar } from "@common/utils/avatar.ts";

/**
 * Construye el contexto enriquecido para llamadas al `CommentsManager` /
 * `AttachmentsManager` ligadas a un issue.
 *
 * Resuelve el issue y el proyecto, valida que existan y devuelve el `pmCtx`
 * + datos de autor para que los `permissionChecker` registrados puedan
 * decidir el acceso.
 *
 * Si `opts.requireAuth` es `true`, exige `ctx.user` y lanza 401 si falta.
 */
export async function buildIssueResourceCtx(
	service: ProjectManagerService,
	kernelKey: symbol,
	ctx: EndpointCtx<{ id?: string; issueId?: string }>,
	opts: { requireAuth?: boolean; rawIssueId?: string } = {}
): Promise<{
	project: Project;
	issue: Issue;
	commentCtx: IssueCommentEndpointCtx;
	attachmentCtx: IssueAttachmentEndpointCtx;
}> {
	const issueId = opts.rawIssueId ?? ctx.params.id ?? ctx.params.issueId;
	if (!issueId) throw new ProjectManagerError(400, "MISSING_FIELDS", "issueId requerido");

	if (opts.requireAuth && !ctx.user) {
		throw new AuthError(401, "UNAUTHORIZED", "Authentication required");
	}

	const caller = await service.resolveCaller(kernelKey, ctx);
	const issue = await service.issues.get(issueId, ctx.token ?? undefined, caller);
	if (!issue) throw new ProjectManagerError(404, "ISSUE_NOT_FOUND", `Issue ${issueId} no encontrado`);

	const project = await service.projects.getProject(issue.projectId, ctx.token ?? undefined, caller);
	if (!project) throw new ProjectManagerError(404, "PROJECT_NOT_FOUND", `Proyecto ${issue.projectId} no encontrado`);

	const pmCtx = await service.buildPMCtx(kernelKey, ctx);
	const userId = ctx.user?.id ?? "";
	const tokenOrgId = ctx.user?.orgId ?? null;
	const authorName = ctx.user?.username;
	const authorImage = resolveUserAvatar(ctx.user as { metadata?: Record<string, unknown> } | undefined);

	const base = {
		userId,
		tokenOrgId,
		project,
		issue,
		pmCtx,
	};
	const commentCtx: IssueCommentEndpointCtx = { ...base, authorName, authorImage };
	const attachmentCtx: IssueAttachmentEndpointCtx = base;
	return { project, issue, commentCtx, attachmentCtx };
}
