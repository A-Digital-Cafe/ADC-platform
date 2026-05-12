import { createAdcApi } from "@ui-library/utils/adc-fetch";
import type { Organization as BaseOrganization } from "@common/types/identity/index.js";

/**
 * Identity API client
 * Backend: IdentityManagerService
 */
const identityApi = createAdcApi({
	basePath: "/api/identity",
	devPort: 3000,
	credentials: process.env.NODE_ENV === "development" ? "include" : "same-origin",
});

export interface SocialNetwork {
	platform: string;
	icon: string;
	url: string;
}

export interface Organization extends BaseOrganization {
	id: string;
	name: string;
	description: string;
	email: string;
	url: string;
	logo?: string;
	owner: {
		id: string;
		name: string;
		email: string;
		role?: string;
	};
	socialNetworks?: SocialNetwork[];
	metadata?: Record<string, any>;
}

/**
 * API client for organization management
 */
export const orgApi = {
	/**
	 * List user's organizations
	 */
	listOrganizations: () => identityApi.get<{ organizations: Organization[] }>("/organizations"),

	/**
	 * Get organization by slug or ID
	 */
	getOrganizationBySlug: (slugOrId: string) => identityApi.get<{ success: boolean; data: Organization }>(`/organizations/${slugOrId}`),

	/**
	 * Request new organization creation
	 */
	requestOrganization: (data: {
		name: string;
		email: string;
		description?: string;
		url?: string;
		socialNetworks?: Array<{ platform: string; url: string }>;
	}) =>
		identityApi.post<{
			success: boolean;
			ticketId: string;
			ticketKey: string;
			message: string;
		}>("/organizations/request", {
			body: data,
		}),
};
