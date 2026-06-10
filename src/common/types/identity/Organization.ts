import { Permission } from "./Permission.js";

export type OrganizationStatus = "active" | "inactive" | "blocked";
export type OrganizationTier = "default" | "team" | "enterprise";

/** Tiers de organización en orden ascendente (`default` = free).
 * @public
 */
export const ORGANIZATION_TIERS: readonly OrganizationTier[] = ["default", "team", "enterprise"] as const;

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
