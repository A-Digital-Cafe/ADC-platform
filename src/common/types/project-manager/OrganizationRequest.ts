export interface OrganizationRequestSocialNetwork {
	platform: string;
	url: string;
}

export interface CreateOrganizationRequestInput {
	name: string;
	email: string;
	description?: string;
	url?: string;
	socialNetworks?: OrganizationRequestSocialNetwork[];
}

export interface OrganizationRequestIssueResponse {
	ticketId: string;
	ticketKey: string;
	message: string;
}
