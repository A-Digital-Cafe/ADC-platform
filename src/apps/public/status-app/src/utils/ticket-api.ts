import { createAdcApi } from "@ui-library/utils/adc-fetch";
import type { CreateSupportTicketInput, SupportTicketIssueResponse } from "@common/types/project-manager/SupportTicket.ts";

const api = createAdcApi({
	basePath: "/api/pm",
	devPort: 3000,
	credentials: process.env.NODE_ENV === "development" ? "include" : "same-origin",
});

export const ticketApi = {
	create: (data: CreateSupportTicketInput) =>
		api.post<SupportTicketIssueResponse>("/support-tickets", {
			body: data,
			idempotencyData: data,
		}),
};

export type {
	CreateSupportTicketInput,
	SupportTicketIssueResponse,
	SupportTicketType,
} from "@common/types/project-manager/SupportTicket.ts";
