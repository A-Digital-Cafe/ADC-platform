import { createAdcApi } from "@ui-library/utils/adc-fetch";
import type { CreateOrganizationRequestInput, OrganizationRequestIssueResponse } from "@common/types/project-manager/OrganizationRequest.ts";

const api = createAdcApi({
	basePath: "/api/pm",
	devPort: 3000,
	credentials: process.env.NODE_ENV === "development" ? "include" : "same-origin",
});

export const orgRequestApi = {
	create: (data: CreateOrganizationRequestInput) =>
		api.post<OrganizationRequestIssueResponse>("/organization-requests", {
			body: data,
			idempotencyData: data,
		}),
};

export type {
	CreateOrganizationRequestInput,
	OrganizationRequestIssueResponse,
	OrganizationRequestSocialNetwork,
} from "@common/types/project-manager/OrganizationRequest.ts";
