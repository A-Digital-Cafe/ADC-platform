import type { Model } from "mongoose";
import type { Project, ProjectVisibility } from "@common/types/project-manager/Project.ts";
import type { ILogger } from "../../../../interfaces/utils/ILogger.js";
import { generateId } from "@common/utils/crypto.ts";
import { applyProjectDefaults, validateKanbanColumns } from "../utils/defaults.ts";
import { type AuthVerifierGetter, PermissionChecker } from "@common/types/auth-verifier.ts";
import { PMScopes, PM_RESOURCE_NAME } from "@common/types/project-manager/permissions.ts";
import { CRUDXAction } from "@common/types/Actions.ts";
import { ProjectManagerError } from "@common/types/custom-errors/ProjectManagerError.ts";
import { filterVisibleProjects, isProjectMember } from "../utils/project-access.ts";
import { getPMTierLimits } from "@common/types/project-manager/tier-limits.ts";
import { docToPlain, stripImmutableFields } from "./shared.ts";

/** Campos que nunca deben mutarse vía un PUT genérico. */
const PROJECT_IMMUTABLE_FIELDS: readonly (keyof Project)[] = [
	"id",
	"createdAt",
	"issueCounter",
	// El ownership / visibilidad / contexto org se gestionan por endpoints dedicados.
	"ownerId",
	"orgId",
	"visibility",
	"slug",
];

interface ListProjectsContext {
	userId: string;
	groupIds: string[];
	tokenOrgId: string | null;
	hasGlobalPMRead: boolean;
	isGlobalAdmin: boolean;
}

/** Contexto del caller para evaluar acceso alternativo por membresía. */
export interface CallerMembership {
	userId: string;
	groupIds: string[];
	tokenOrgId: string | null;
}

/**
 * Contexto PM resuelto del caller. Unificado para list/create/update/delete y
 * reutilizable por otros scopes (sprints/milestones/issues) que quieran
 * consultar flags de rol o quota sin repetir resolución.
 *
 * Campos derivados:
 *  - `isGlobalAdmin`: rol `Admin` a nivel global (token sin orgId).
 *  - `hasGlobalPMRead` / `hasGlobalPMWrite`: permisos formales globales.
 *  - `tokenOrgId`: `orgId` del token actual (modo org) o `null`.
 *  - `isOrgAdminOrPM(orgId)`: función memoizable para chequear admin/PM en una org.
 */
export interface PMCtx extends CallerMembership {
	tokenOrgId: string | null;
	isGlobalAdmin: boolean;
	hasGlobalPMRead: boolean;
	hasGlobalPMWrite: boolean;
	isOrgAdminOrPM: (orgId: string) => Promise<boolean>;
}

/** Accesores internos para otros DAOs del mismo service. No consumirlos desde
 * endpoints: las operaciones aquí expuestas no pasan por `requirePermission`.
 */
export interface ProjectInternals {
	fetchProject: (projectId: string) => Promise<Project | null>;
	incrementIssueCounter: (projectId: string) => Promise<number>;
	fetchProjectBySlug: (slug: string, orgId: string | null) => Promise<Project | null>;
}

export class ProjectManager {
	readonly #permissionChecker: PermissionChecker;
	readonly #kernelKey: symbol;

	constructor(
		private readonly projectModel: Model<Project>,
		kernelKey: symbol,
		private readonly logger: ILogger,
		getAuthVerifier: AuthVerifierGetter = () => null
	) {
		this.#kernelKey = kernelKey;
		this.#permissionChecker = new PermissionChecker(getAuthVerifier, "ProjectManager", PM_RESOURCE_NAME);
	}

	async createProject(input: Partial<Project> & Pick<Project, "name" | "slug">, ctx: PMCtx, token?: string): Promise<Project> {
		// Resolver userId: permite sin token si es contexto de sistema (admin global + sin token)
		let userId: string;
		if (!token && ctx.isGlobalAdmin && ctx.userId) {
			// Contexto de sistema: permitir sin token
			userId = ctx.userId;
		} else {
			// Requerir token para cualquier otro caso
			userId = await this.#permissionChecker.resolveUserId(token);
		}
		const callerId = ctx.userId || userId || "";

		const visibility: ProjectVisibility = input.visibility ?? "private";
		const requestedOrgId = input.orgId ?? null;

		// Resolver orgId final + autorización según visibilidad
		let orgId: string | null;
		switch (visibility) {
			case "public": {
				// Solo admin global o usuario con PM.WRITE global (token sin orgId).
				const allowed = ctx.isGlobalAdmin || (ctx.tokenOrgId === null && ctx.hasGlobalPMWrite);
				if (!allowed) {
					throw new ProjectManagerError(403, "PROJECT_ACCESS_DENIED", "Solo un admin global puede crear proyectos públicos");
				}
				orgId = null;
				break;
			}
			case "org": {
				// Admin global elige org explícitamente; en modo org usa la del token.
				const targetOrg = ctx.isGlobalAdmin ? requestedOrgId : (ctx.tokenOrgId ?? requestedOrgId);
				if (!targetOrg) {
					throw new ProjectManagerError(400, "MISSING_FIELDS", "`orgId` requerido para proyecto de organización");
				}
				if (!ctx.isGlobalAdmin) {
					if (ctx.tokenOrgId && ctx.tokenOrgId !== targetOrg) {
						throw new ProjectManagerError(403, "ORG_ACCESS_DENIED", "No tienes acceso a esa organización");
					}
					const isOrgAdmin = await ctx.isOrgAdminOrPM(targetOrg);
					if (!isOrgAdmin) {
						throw new ProjectManagerError(
							403,
							"PROJECT_ACCESS_DENIED",
							"Solo un Admin o Project Manager de la organización puede crear proyectos de organización"
						);
					}
				}
				await this.#enforceOrgProjectLimit(targetOrg);
				orgId = targetOrg;
				break;
			}
			case "private": {
				// Un proyecto privado nunca puede estar asociado a una organización.
				if (requestedOrgId)
					throw new ProjectManagerError(400, "INVALID_VISIBILITY", "Un proyecto privado no puede estar asociado a una organización");

				await this.#enforcePrivateProjectLimit(callerId);
				orgId = null;
				break;
			}
			default:
				throw new ProjectManagerError(400, "INVALID_VISIBILITY", `Visibilidad desconocida: ${String(visibility)}`);
		}

		const project = applyProjectDefaults({
			...input,
			id: generateId(),
			ownerId: input.ownerId ?? callerId,
			orgId,
			visibility,
		});

		validateKanbanColumns(project.kanbanColumns);

		try {
			await this.projectModel.create(project);
		} catch (error: any) {
			if (error.code === 11000) {
				throw new ProjectManagerError(409, "SLUG_TAKEN", `El slug '${project.slug}' ya existe en este contexto`);
			}
			throw error;
		}

		this.logger.logDebug(`Proyecto creado: ${project.slug} (org=${project.orgId ?? "GLOBAL"}, vis=${project.visibility})`);
		return project;
	}

	async #enforcePrivateProjectLimit(userId: string): Promise<void> {
		if (!userId) return;
		const { maxPrivateProjectsPerUser } = getPMTierLimits();
		const count = await this.projectModel.countDocuments({ visibility: "private", ownerId: userId });
		if (count >= maxPrivateProjectsPerUser) {
			throw new ProjectManagerError(403, "TIER_LIMIT_REACHED", `Límite de proyectos privados alcanzado (${maxPrivateProjectsPerUser})`);
		}
	}

	async #enforceOrgProjectLimit(orgId: string): Promise<void> {
		const { maxProjectsPerOrg } = getPMTierLimits();
		const count = await this.projectModel.countDocuments({ orgId });
		if (count >= maxProjectsPerOrg) {
			throw new ProjectManagerError(403, "TIER_LIMIT_REACHED", `Límite de proyectos de la organización alcanzado (${maxProjectsPerOrg})`);
		}
	}

	async #fetchProject(projectId: string): Promise<Project | null> {
		return docToPlain<Project>(await this.projectModel.findOne({ id: projectId }));
	}

	async #fetchProjectBySlug(slug: string, orgId: string | null): Promise<Project | null> {
		return docToPlain<Project>(await this.projectModel.findOne({ slug, orgId }));
	}

	async getProject(projectId: string, token?: string, caller?: CallerMembership): Promise<Project | null> {
		const project = await this.#fetchProject(projectId);
		await this.#permissionChecker.requirePermission(token, CRUDXAction.READ, PMScopes.PROJECTS, {
			ownerId: project?.ownerId,
			allowIf: (uid) => isProjectMember(project, { id: uid, groupIds: caller?.groupIds ?? [] }, caller?.tokenOrgId ?? null),
		});
		return project;
	}

	async getProjectBySlug(slug: string, orgId: string | null, token?: string, caller?: CallerMembership): Promise<Project | null> {
		const project = await this.#fetchProjectBySlug(slug, orgId);
		await this.#permissionChecker.requirePermission(token, CRUDXAction.READ, PMScopes.PROJECTS, {
			ownerId: project?.ownerId,
			allowIf: (uid) => isProjectMember(project, { id: uid, groupIds: caller?.groupIds ?? [] }, caller?.tokenOrgId ?? null),
		});
		return project;
	}

	/**
	 * Obtener proyecto por slug sin validar membresía.
	 * USO: Solo desde endpoints que ya validaron permisos de admin global.
	 * El token DEBE ser de un admin global con ORGANIZATIONS.READ.
	 */
	async getProjectBySlugForAdmin(slug: string, orgId: string | null, token?: string): Promise<Project | null> {
		// Validar que el token corresponde a un admin global
		const userId = await this.#permissionChecker.resolveUserId(token);
		if (!userId) {
			throw new ProjectManagerError(401, "PROJECT_ACCESS_DENIED", "Token inválido para acceso admin");
		}
		// Nota: Quien llama debe verificar ORGANIZATIONS.READ antes de llamar este método
		const project = await this.#fetchProjectBySlug(slug, orgId);
		return project;
	}

	/** Comprobación pública de existencia de slug (no expone el proyecto). */
	async isSlugAvailable(slug: string, orgId: string | null, token?: string): Promise<boolean> {
		await this.#permissionChecker.resolveUserId(token);
		const existing = await this.#fetchProjectBySlug(slug, orgId);
		return !existing;
	}

	async listVisibleProjects(ctx: ListProjectsContext, token?: string): Promise<Project[]> {
		await this.#permissionChecker.resolveUserId(token);

		if (ctx.isGlobalAdmin) {
			const docs = await this.projectModel.find({});
			return docs.map((d) => docToPlain<Project>(d)!);
		}

		const orConditions: Record<string, unknown>[] = [];
		// Lectura global: sólo proyectos públicos (no privados) de contexto global.
		if (ctx.hasGlobalPMRead) orConditions.push({ orgId: null, visibility: { $ne: "private" } });
		// Dentro de una org: proyectos de la org (los privados por invariante no tienen orgId,
		// el filtro es defensivo por si quedaran datos antiguos).
		if (ctx.tokenOrgId) orConditions.push({ orgId: ctx.tokenOrgId, visibility: { $ne: "private" } });
		// Membresía: el token debe estar en el mismo contexto org que el proyecto.
		// Con token personal (tokenOrgId=null) sólo aplica a proyectos globales (orgId=null);
		// con token de org aplica a proyectos globales o de esa org.
		const membershipOrgFilter = ctx.tokenOrgId ? { orgId: { $in: [null, ctx.tokenOrgId] } } : { orgId: null };
		orConditions.push({ ...membershipOrgFilter, memberUserIds: ctx.userId }, { ...membershipOrgFilter, ownerId: ctx.userId });
		if (ctx.groupIds.length) orConditions.push({ ...membershipOrgFilter, memberGroupIds: { $in: ctx.groupIds } });

		const docs = orConditions.length ? await this.projectModel.find({ $or: orConditions }) : [];
		const projects = docs.map((d) => docToPlain<Project>(d)!);
		return filterVisibleProjects(projects, ctx);
	}

	async updateProject(projectId: string, updates: Partial<Project>, token?: string, _caller?: CallerMembership): Promise<Project> {
		const project = await this.#fetchProject(projectId);
		if (!project) throw new ProjectManagerError(404, "PROJECT_NOT_FOUND", `Proyecto ${projectId} no encontrado`);

		await this.#permissionChecker.requirePermission(token, CRUDXAction.UPDATE, PMScopes.PROJECTS, {
			ownerId: project.ownerId,
			allowIf: (uid) => project.ownerId === uid,
		});

		if (updates.kanbanColumns) validateKanbanColumns(updates.kanbanColumns);

		const safeUpdates = { ...stripImmutableFields(updates, PROJECT_IMMUTABLE_FIELDS), updatedAt: new Date() };

		const updated = await this.projectModel.findOneAndUpdate({ id: projectId }, safeUpdates, { new: true });
		if (!updated) throw new ProjectManagerError(404, "PROJECT_NOT_FOUND", `Proyecto ${projectId} no encontrado`);
		return docToPlain<Project>(updated)!;
	}

	async deleteProject(projectId: string, token?: string, caller?: CallerMembership): Promise<void> {
		const project = await this.#fetchProject(projectId);
		if (!project) throw new ProjectManagerError(404, "PROJECT_NOT_FOUND", `Proyecto ${projectId} no encontrado`);

		await this.#permissionChecker.requirePermission(token, CRUDXAction.DELETE, PMScopes.PROJECTS, {
			ownerId: project.ownerId,
			// El owner de un proyecto privado puede eliminarlo aunque no tenga PM.DELETE global.
			allowIf: (uid) => project.visibility === "private" && project.ownerId === uid && uid === (caller?.userId ?? uid),
		});

		const result = await this.projectModel.deleteOne({ id: projectId });
		if (result.deletedCount === 0) {
			throw new ProjectManagerError(404, "PROJECT_NOT_FOUND", `Proyecto ${projectId} no encontrado`);
		}
		this.logger.logDebug(`Proyecto eliminado: ${projectId}`);
	}

	async #incrementIssueCounter(projectId: string): Promise<number> {
		const updated = await this.projectModel.findOneAndUpdate({ id: projectId }, { $inc: { issueCounter: 1 } }, { new: true });
		if (!updated) throw new ProjectManagerError(404, "PROJECT_NOT_FOUND", `Proyecto ${projectId} no encontrado`);
		return docToPlain<Project>(updated)!.issueCounter;
	}

	/**
	 * Devuelve accesores sin autorización para uso exclusivo de otros DAOs del
	 * mismo service. Protegido por `kernelKey`: sólo el service que creó este
	 * manager puede obtenerlos.
	 */
	getInternals(_kernelKey: symbol): ProjectInternals {
		if (_kernelKey !== this.#kernelKey) throw new Error("Acceso denegado: kernel key inválida");

		return {
			fetchProject: (id) => this.#fetchProject(id),
			incrementIssueCounter: (id) => this.#incrementIssueCounter(id),
			fetchProjectBySlug: (slug, orgId) => this.#fetchProjectBySlug(slug, orgId),
		};
	}
}
