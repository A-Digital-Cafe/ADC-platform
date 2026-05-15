import { Permission } from "./Permission.ts";

export type OrganizationStatus = "active" | "inactive" | "blocked";
export type OrganizationTier = "default";

/**
 * Organización
 */
export interface Organization {
	orgId: string;
	slug: string;
	region: string;
	tier: OrganizationTier;
	status: OrganizationStatus;
	approved: boolean;
	permissions?: Permission[];
	metadata?: Record<string, any>;
	createdAt: Date;
	updatedAt: Date;
}
