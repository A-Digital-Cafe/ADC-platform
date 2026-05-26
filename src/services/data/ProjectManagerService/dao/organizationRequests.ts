import type { Block } from "@common/ADC/types/learning.ts";
import { ProjectManagerError } from "@common/types/custom-errors/ProjectManagerError.ts";
import type { CreateOrganizationRequestInput, OrganizationRequestIssueResponse } from "@common/types/project-manager/OrganizationRequest.ts";
import { TICKET_COLUMN_MAP, type CommonTicketColumnKey } from "@common/types/project-manager/CommonTicketColumns.ts";
import type { IssueManager } from "./issues.js";
import type { ProjectManager } from "./projects.js";

export interface OrganizationRequestCaller {
	userId: string;
	email?: string;
	ip: string;
}

interface OrganizationRequestConfig {
	organizationRequestsProjectId?: string;
}

export class OrganizationRequestManager {
	constructor(
		private readonly projects: ProjectManager,
		private readonly issues: IssueManager,
		private readonly config: OrganizationRequestConfig = {}
	) {}

	async create(
		kernelKey: symbol,
		input: CreateOrganizationRequestInput,
		caller: OrganizationRequestCaller
	): Promise<OrganizationRequestIssueResponse> {
		const projectId = this.#projectId();
		const project = await this.projects.getInternals(kernelKey).fetchProject(projectId);
		if (!project) {
			throw new ProjectManagerError(
				503,
				"ORG_REQUEST_PROJECT_UNAVAILABLE",
				"El proyecto configurado para solicitudes de organización no existe"
			);
		}

		
		const columnKey: CommonTicketColumnKey = TICKET_COLUMN_MAP["org-request"];

		const issue = await this.issues.createInternal(
			kernelKey,
			project,
			{
				title: `Solicitud de organización: ${input.name}`,
				description: organizationRequestBlocks(input, caller),
				category: "task",
				columnKey,
				customFields: organizationRequestCustomFields(input, caller),
			},
			caller.userId
		);

		return {
			ticketId: issue.id,
			ticketKey: issue.key,
			message: `Solicitud creada. El ID es ${issue.key}.`,
		};
	}

	#projectId(): string {
		const projectId =
			this.config.organizationRequestsProjectId?.trim() ||
			process.env.ORG_MANAGEMENT_PROJECT_ID?.trim() ||
			process.env.PM_ORG_REQUESTS_PROJECT_ID?.trim() ||
			"";

		if (!projectId) {
			throw new ProjectManagerError(
				503,
				"ORG_REQUEST_PROJECT_NOT_CONFIGURED",
				"Falta configurar ORG_MANAGEMENT_PROJECT_ID para crear solicitudes de organización"
			);
		}
		return projectId;
	}
}

function organizationRequestCustomFields(input: CreateOrganizationRequestInput, caller: OrganizationRequestCaller) {
	return {
		type: "org_creation_request",
		requestedByUserId: caller.userId,
		requestedByEmail: caller.email ?? null,
		requestIp: caller.ip,
		organizationName: input.name,
		organizationEmail: input.email,
		organizationUrl: input.url ?? null,
		socialNetworks: input.socialNetworks?.map((item) => `${item.platform}: ${item.url}`) ?? [],
	};
}

function organizationRequestBlocks(input: CreateOrganizationRequestInput, caller: OrganizationRequestCaller): Block[] {
	const blocks: Block[] = [
		{ type: "heading", level: 3, text: "Información de la organización" },
		{ type: "paragraph", text: `Nombre: ${input.name}` },
		{ type: "paragraph", text: `Email: ${input.email}` },
		{ type: "paragraph", text: `Sitio web: ${input.url || "No proporcionado"}` },
		{ type: "heading", level: 3, text: "Descripción" },
		{ type: "paragraph", text: input.description || "Sin descripción adicional" },
		{ type: "heading", level: 3, text: "Redes sociales / canales" },
	];

	if (input.socialNetworks?.length) {
		blocks.push({ type: "list", ordered: false, items: input.socialNetworks.map((item) => `${item.platform}: ${item.url}`) });
	} else {
		blocks.push({ type: "paragraph", text: "No especificadas" });
	}

	blocks.push(
		{ type: "heading", level: 3, text: "Solicitante" },
		{ type: "paragraph", text: `ID de usuario: ${caller.userId}` },
		{ type: "paragraph", text: `Email de sesión: ${caller.email || "No disponible"}` },
		{ type: "paragraph", text: `IP: ${caller.ip}` }
	);

	return blocks;
}
