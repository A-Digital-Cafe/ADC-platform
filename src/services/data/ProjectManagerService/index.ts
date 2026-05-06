import type MongoProvider from "../../../providers/object/mongo/index.js";
import { BaseService } from "../../BaseService.js";
import { projectSchema, sprintSchema, milestoneSchema, issueSchema } from "./domain/index.js";
import { ProjectManager, SprintManager, MilestoneManager, IssueManager } from "./dao/index.js";
import { type IAuthVerifier, type AuthVerifierGetter } from "@common/types/auth-verifier.ts";
import type IdentityManagerService from "../../core/IdentityManagerService/index.js";
import type { EndpointCtx } from "../../core/EndpointManagerService/index.js";
import { EnableEndpoints, DisableEndpoints } from "../../core/EndpointManagerService/index.js";
import { ProjectEndpoints } from "./endpoints/projects.js";
import { SprintEndpoints } from "./endpoints/sprints.js";
import { MilestoneEndpoints } from "./endpoints/milestones.js";
import { IssueEndpoints } from "./endpoints/issues.js";
import { IssueCommentsEndpoints } from "./endpoints/comments.js";
import { IssueAttachmentsEndpoints } from "./endpoints/attachments.js";
import { PMScopes } from "@common/types/project-manager/permissions.ts";
import { CRUDXAction } from "@common/types/Actions.ts";
import { OnlyKernel } from "../../../utils/decorators/OnlyKernel.ts";
import type { Project } from "@common/types/project-manager/Project.ts";
import type { Sprint } from "@common/types/project-manager/Sprint.ts";
import type { Milestone } from "@common/types/project-manager/Milestone.ts";
import type { Issue } from "@common/types/project-manager/Issue.ts";
import type { CallerMembership, PMCtx } from "./dao/projects.ts";
import { Kernel } from "../../../kernel.ts";
import { hasGlobalAdminRole, isOrgAdminOrPM } from "./utils/pm-roles.ts";
import type AttachmentsUtility from "../../../utilities/attachments/attachments-utility/index.js";
import type CommentsUtility from "../../../utilities/comments/comments-utility/index.js";
import type { AttachmentsManager, SubPathContext } from "../../../utilities/attachments/attachments-utility/index.js";
import type { CommentsManager } from "../../../utilities/comments/comments-utility/index.js";
import type InternalS3Provider from "../../../providers/object/internal-s3-provider/index.js";
import { issueAttachmentsChecker } from "./permissions/issueAttachments.ts";
import { issueCommentsChecker } from "./permissions/issueComments.ts";
import { ProjectManagerError as ProjectManagerErrorRef } from "@common/types/custom-errors/ProjectManagerError.ts";

export default class ProjectManagerService extends BaseService {
	public readonly name = "ProjectManagerService";

	#projectManager: ProjectManager | null = null;
	#sprintManager: SprintManager | null = null;
	#milestoneManager: MilestoneManager | null = null;
	#issueManager: IssueManager | null = null;
	#issueAttachmentsManager: AttachmentsManager | null = null;
	#issueCommentsManager: CommentsManager | null = null;

	#authVerifier: IAuthVerifier | null = null;
	#identity: IdentityManagerService | null = null;
	#internalRoles: ReturnType<IdentityManagerService["_internal"]>["roles"] | null = null;

	private mongoProvider!: MongoProvider;
	readonly #kernelRef: Kernel;

	constructor(kernel: Kernel, options?: any) {
		super(kernel, options);
		this.#kernelRef = kernel;
	}

	readonly #getAuthVerifier: AuthVerifierGetter = () => this.#authVerifier;

	@EnableEndpoints({
		managers: () => [
			ProjectEndpoints,
			SprintEndpoints,
			MilestoneEndpoints,
			IssueEndpoints,
			IssueCommentsEndpoints,
			IssueAttachmentsEndpoints,
		],
	})
	async start(kernelKey: symbol): Promise<void> {
		await super.start(kernelKey);

		this.mongoProvider = this.getMyProvider<MongoProvider>("object/mongo");
		await this.waitForMongo();

		this.#identity = this.#kernelRef.registry.getService<IdentityManagerService>("IdentityManagerService");
		this.#internalRoles = this.#identity?._internal(kernelKey).roles ?? null;

		const ProjectModel = this.mongoProvider.createModel<Project>("projects", projectSchema);
		const SprintModel = this.mongoProvider.createModel<Sprint>("sprints", sprintSchema);
		const MilestoneModel = this.mongoProvider.createModel<Milestone>("milestones", milestoneSchema);
		const IssueModel = this.mongoProvider.createModel<Issue>("issues", issueSchema);

		this.#projectManager = new ProjectManager(ProjectModel, kernelKey, this.logger, this.#getAuthVerifier);
		const projectInternals = this.#projectManager.getInternals(kernelKey);
		this.#sprintManager = new SprintManager(SprintModel, projectInternals, this.logger, this.#getAuthVerifier);
		this.#milestoneManager = new MilestoneManager(MilestoneModel, projectInternals, this.logger, this.#getAuthVerifier);
		this.#issueManager = new IssueManager(IssueModel, projectInternals, this.logger, this.#getAuthVerifier);

		this.#authVerifier = this.#identity.createAuthVerifier();

		// --- Attachments + Comments wiring ---
		try {
			const s3 = this.getMyProvider<InternalS3Provider>("object/internal-s3-provider");
			const attachmentsUtil = this.getMyUtility<AttachmentsUtility>("attachments-utility");
			const commentsUtil = this.getMyUtility<CommentsUtility>("comments-utility");
			const connection = this.mongoProvider.getConnection();

			this.#issueAttachmentsManager = attachmentsUtil.createAttachmentsManager({
				mongoConnection: connection,
				collectionName: "pm_attachments",
				s3Provider: s3,
				basePath: "projects",
				subPathResolver: (ctx: SubPathContext) => {
					const projectId = (ctx as any).project?.id ?? "_";
					const issueId = (ctx as any).issue?.id ?? ctx.ownerId ?? "_";
					return ctx.ownerType === "pm-issue-comment" ? `${projectId}/${issueId}/comments` : `${projectId}/${issueId}`;
				},
				permissionChecker: issueAttachmentsChecker,
			});

			this.#issueCommentsManager = commentsUtil.createCommentsManager({
				mongoConnection: connection,
				collectionName: "pm_comments",
				attachmentsManager: this.#issueAttachmentsManager,
				permissionChecker: issueCommentsChecker,
			});
		} catch (e) {
			const err = e as Error;
			this.logger.logWarn(
				`No se pudieron inicializar attachments/comments del PM: ${err.message}. Endpoints relacionados fallarán con 503 hasta que estén disponibles.`
			);
			if (err.stack) this.logger.logDebug(err.stack);
		}

		ProjectEndpoints.init(this, kernelKey);
		SprintEndpoints.init(this, kernelKey);
		MilestoneEndpoints.init(this, kernelKey);
		IssueEndpoints.init(this, kernelKey);
		IssueCommentsEndpoints.init(this, kernelKey);
		IssueAttachmentsEndpoints.init(this, kernelKey);

		this.logger.logOk("ProjectManagerService iniciado");
	}

	/**
	 * Resuelve `userId` + `groupIds` del caller desde el token y cachea en `ctx`.
	 * Restringido a llamadas que posean la `kernelKey` del service (típicamente,
	 * los endpoints registrados vía `init(this, kernelKey)`).
	 */
	@OnlyKernel()
	async resolveCaller(_kernelKey: symbol, ctx: EndpointCtx): Promise<CallerMembership> {
		const cacheKey = Symbol.for("PMCallerMembership");
		const cached = (ctx as any)[cacheKey];
		if (cached) return cached;

		const userId = ctx.user?.id ?? "";
		const tokenOrgId = ctx.user?.orgId ?? null;
		let groupIds: string[] = [];
		if (userId) {
			try {
				const full = await this.identity.users.getUser(userId, ctx.token ?? undefined);
				groupIds = full?.groupIds ?? [];
			} catch {
				groupIds = [];
			}
		}
		const caller: CallerMembership = { userId, groupIds, tokenOrgId };
		Object.defineProperty(ctx, cacheKey, { value: caller, enumerable: false });
		return caller;
	}

	@OnlyKernel()
	async listProjectsForCaller(_kernelKey: symbol, ctx: EndpointCtx): Promise<Project[]> {
		const pmCtx = await this.buildPMCtx(_kernelKey, ctx);
		return this.projects.listVisibleProjects(pmCtx, ctx.token ?? undefined);
	}

	/**
	 * Construye el contexto PM del caller (roles, permisos globales, tokenOrgId,
	 * helper `isOrgAdminOrPM`). Cacheado en `ctx` para evitar relecturas.
	 *
	 * Válido para list / create / update / delete y reutilizable desde otros
	 * scopes (sprints/milestones/issues) cuando necesiten los flags de rol.
	 */
	@OnlyKernel()
	async buildPMCtx(_kernelKey: symbol, ctx: EndpointCtx): Promise<PMCtx> {
		const cacheKey = Symbol.for("PMCtx");
		const cached = (ctx as any)[cacheKey];
		if (cached) return cached;

		const caller = await this.resolveCaller(_kernelKey, ctx);
		const identity = this.#identity!;
		const internalRoles = this.#internalRoles!;
		const tokenOrgId = ctx.user?.orgId ?? null;
		const user = caller.userId ? await identity.users.getUser(caller.userId, ctx.token ?? undefined) : null;
		const [globalAdminRole, hasGlobalPMRead, hasGlobalPMWrite] = await Promise.all([
			hasGlobalAdminRole(internalRoles, user),
			identity.permissions.hasPermission(caller.userId, CRUDXAction.READ, PMScopes.PROJECTS),
			identity.permissions.hasPermission(caller.userId, CRUDXAction.WRITE, PMScopes.PROJECTS),
		]);
		const isGlobalAdmin = !tokenOrgId && globalAdminRole;

		// Memoizar `isOrgAdminOrPM` por orgId para no repetir lookup en una misma request.
		const orgRoleCache = new Map<string, Promise<boolean>>();

		const pmCtx: PMCtx = {
			userId: caller.userId,
			groupIds: caller.groupIds,
			tokenOrgId,
			isGlobalAdmin,
			hasGlobalPMRead,
			hasGlobalPMWrite,
			isOrgAdminOrPM: (orgId: string) => {
				let p = orgRoleCache.get(orgId);
				if (!p) {
					p = isOrgAdminOrPM(internalRoles, user, orgId);
					orgRoleCache.set(orgId, p);
				}
				return p;
			},
		};
		Object.defineProperty(ctx, cacheKey, { value: pmCtx, enumerable: false });
		return pmCtx;
	}

	get projects(): ProjectManager {
		if (!this.#projectManager) throw new Error("ProjectManager not initialized");
		return this.#projectManager;
	}
	get sprints(): SprintManager {
		if (!this.#sprintManager) throw new Error("SprintManager not initialized");
		return this.#sprintManager;
	}
	get milestones(): MilestoneManager {
		if (!this.#milestoneManager) throw new Error("MilestoneManager not initialized");
		return this.#milestoneManager;
	}
	get issues(): IssueManager {
		if (!this.#issueManager) throw new Error("IssueManager not initialized");
		return this.#issueManager;
	}
	get identity(): IdentityManagerService {
		if (!this.#identity) throw new Error("IdentityManagerService not initialized");
		return this.#identity;
	}

	get issueAttachments(): AttachmentsManager {
		if (!this.#issueAttachmentsManager)
			throw new ProjectManagerErrorRef(503, "ATTACHMENTS_UNAVAILABLE", "Attachments no disponibles (provider/utility no inicializado)");
		return this.#issueAttachmentsManager;
	}

	get issueComments(): CommentsManager {
		if (!this.#issueCommentsManager)
			throw new ProjectManagerErrorRef(503, "COMMENTS_UNAVAILABLE", "Comments no disponibles (provider/utility no inicializado)");
		return this.#issueCommentsManager;
	}

	@DisableEndpoints()
	async stop(kernelKey: symbol): Promise<void> {
		await super.stop(kernelKey);
		this.#authVerifier = null;
		this.logger.logOk("ProjectManagerService detenido");
	}

	private async waitForMongo(): Promise<void> {
		const maxWaitTime = 10000;
		const startTime = Date.now();

		while (!this.mongoProvider.isConnected() && Date.now() - startTime < maxWaitTime) {
			await new Promise((resolve) => setTimeout(resolve, 500));
		}

		if (!this.mongoProvider.isConnected()) {
			throw new Error("MongoDB no pudo conectarse en el tiempo esperado");
		}
	}
}
