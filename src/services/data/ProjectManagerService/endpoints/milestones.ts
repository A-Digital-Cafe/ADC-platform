import { RegisterEndpoint, type EndpointCtx } from "../../../core/EndpointManagerService/index.js";
import { ProjectManagerError } from "@common/types/custom-errors/ProjectManagerError.ts";
import type ProjectManagerService from "../index.js";
import type { Milestone } from "@common/types/project-manager/Milestone.ts";

const MILESTONE_CREATE_RATE_LIMIT = { max: 20, timeWindow: 60_000 };
const MILESTONE_UPDATE_RATE_LIMIT = { max: 30, timeWindow: 60_000 };
const MILESTONE_DELETE_RATE_LIMIT = { max: 10, timeWindow: 60_000 };

export class MilestoneEndpoints {
	private static service: ProjectManagerService;
	private static kernelKey: symbol;
	static init(service: ProjectManagerService, kernelKey: symbol): void {
		MilestoneEndpoints.service ??= service;
		MilestoneEndpoints.kernelKey ??= kernelKey;
	}

	@RegisterEndpoint({
		method: "GET",
		url: "/api/pm/projects/:projectId/milestones",
		deferAuth: true,
	})
	static async list(ctx: EndpointCtx<{ projectId: string }>) {
		const service = MilestoneEndpoints.service;
		const caller = await service.resolveCaller(MilestoneEndpoints.kernelKey, ctx);
		return { milestones: await service.milestones.list(ctx.params.projectId, ctx.token ?? undefined, caller) };
	}

	@RegisterEndpoint({
		method: "POST",
		url: "/api/pm/projects/:projectId/milestones",
		deferAuth: true,
		options: { rateLimit: MILESTONE_CREATE_RATE_LIMIT },
	})
	static async create(ctx: EndpointCtx<{ projectId: string }, Partial<Milestone> & { name: string }>) {
		if (!ctx.data?.name) throw new ProjectManagerError(400, "MISSING_FIELDS", "`name` es requerido");
		const service = MilestoneEndpoints.service;
		const caller = await service.resolveCaller(MilestoneEndpoints.kernelKey, ctx);
		return service.milestones.create(ctx.params.projectId, ctx.data, ctx.token ?? undefined, caller);
	}

	@RegisterEndpoint({
		method: "PUT",
		url: "/api/pm/milestones/:id",
		deferAuth: true,
		options: { rateLimit: MILESTONE_UPDATE_RATE_LIMIT },
	})
	static async update(ctx: EndpointCtx<{ id: string }, Partial<Milestone>>) {
		const service = MilestoneEndpoints.service;
		const caller = await service.resolveCaller(MilestoneEndpoints.kernelKey, ctx);
		return service.milestones.update(ctx.params.id, ctx.data ?? {}, ctx.token ?? undefined, caller);
	}

	@RegisterEndpoint({
		method: "DELETE",
		url: "/api/pm/milestones/:id",
		deferAuth: true,
		options: { rateLimit: MILESTONE_DELETE_RATE_LIMIT },
	})
	static async delete(ctx: EndpointCtx<{ id: string }>) {
		const service = MilestoneEndpoints.service;
		const caller = await service.resolveCaller(MilestoneEndpoints.kernelKey, ctx);
		await service.milestones.delete(ctx.params.id, ctx.token ?? undefined, caller);
		return { ok: true };
	}
}
