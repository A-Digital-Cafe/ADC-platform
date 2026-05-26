import type { Block } from "@common/ADC/types/learning.ts";
import { ProjectManagerError } from "@common/types/custom-errors/ProjectManagerError.ts";
import type {
	CreateSupportTicketInput,
	SupportTicketIssueResponse,
	SupportTicketCaller,
	SupportTicketConfig,
} from "@common/types/project-manager/SupportTicket.ts";
import { TICKET_TYPE_LABELS, TICKET_TYPE_CATEGORIES } from "@common/types/project-manager/SupportTicket.ts";
import { TICKET_COLUMN_MAP, type CommonTicketColumnKey } from "@common/types/project-manager/CommonTicketColumns.ts";
import type { IssueManager } from "./issues.js";
import type { ProjectManager } from "./projects.js";

export class SupportTicketManager {
	constructor(
		private readonly projects: ProjectManager,
		private readonly issues: IssueManager,
		private readonly config: SupportTicketConfig = {}
	) {}

	async create(kernelKey: symbol, input: CreateSupportTicketInput, caller: SupportTicketCaller): Promise<SupportTicketIssueResponse> {
		const projectId = this.#projectId();
		const project = await this.projects.getInternals(kernelKey).fetchProject(projectId);
		if (!project) {
			throw new ProjectManagerError(
				503,
				"SUPPORT_TICKET_PROJECT_UNAVAILABLE",
				"El proyecto configurado para tickets de soporte no existe"
			);
		}

		// Asignar columna según el tipo de ticket (tipada)
		const columnKey: CommonTicketColumnKey = TICKET_COLUMN_MAP[input.type];

		const issue = await this.issues.createInternal(
			kernelKey,
			project,
			{
				title: `[${TICKET_TYPE_LABELS[input.type]}] ${input.title}`,
				description: supportTicketBlocks(input, caller),
				category: TICKET_TYPE_CATEGORIES[input.type],
				columnKey,
				customFields: supportTicketCustomFields(input, caller),
			},
			caller.userId
		);

		return {
			ticketId: issue.id,
			ticketKey: issue.key,
			message: `Ticket creado. El ID es ${issue.key}.`,
		};
	}

	#projectId(): string {
		const projectId =
			this.config.supportTicketsProjectId?.trim() ||
			process.env.PM_SUPPORT_TICKETS_PROJECT_ID?.trim() ||
			process.env.ORG_MANAGEMENT_PROJECT_ID?.trim() ||
			"";

		if (!projectId) {
			throw new ProjectManagerError(
				503,
				"SUPPORT_TICKET_PROJECT_NOT_CONFIGURED",
				"Falta configurar PM_SUPPORT_TICKETS_PROJECT_ID o ORG_MANAGEMENT_PROJECT_ID para crear tickets de soporte"
			);
		}
		return projectId;
	}
}

function supportTicketCustomFields(input: CreateSupportTicketInput, caller: SupportTicketCaller) {
	return {
		type: "support_ticket",
		ticketType: input.type,
		ticketTitle: input.title,
		reporterEmail: input.email,
		reportedByUserId: caller.userId,
		reportedByEmail: caller.email ?? null,
	};
}

function supportTicketBlocks(input: CreateSupportTicketInput, caller: SupportTicketCaller): Block[] {
	const blocks: Block[] = [
		{ type: "heading", level: 3, text: `Ticket de ${TICKET_TYPE_LABELS[input.type].toLowerCase()}` },
		{ type: "paragraph", text: `Tipo: ${TICKET_TYPE_LABELS[input.type]}` },
		{ type: "paragraph", text: `Email de contacto: ${input.email}` },
		{ type: "heading", level: 3, text: "Descripción" },
		{ type: "paragraph", text: input.description },
	];

	blocks.push(
		{ type: "heading", level: 3, text: "Información del reporte" },
		{ type: "paragraph", text: `Usuario reportante: ${caller.userId}` },
		{ type: "paragraph", text: `Email de sesión: ${caller.email || "Anónimo"}` }
	);

	return blocks;
}
