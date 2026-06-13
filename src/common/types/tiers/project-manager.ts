/**
 * Límites de Project Manager por tier.
 *
 * Concepto clave: los recursos **personales** (proyectos privados de un usuario)
 * consumen el tier de la **cuenta** (`AccountTier`); los recursos de una
 * **organización** (tableros de org) consumen el tier de la **organización**
 * (`OrganizationTier`). Ambos son independientes: un tablero de org NO descuenta
 * del límite personal del usuario y viceversa.
 *
 * Resolución de tiers: usuario → `user.metadata.accountTier` (default `free`);
 * org → `org.tier` (default `default`).
 */

import type { AccountTier } from "../tiers.ts";
import type { OrganizationTier } from "../identity/Organization.ts";

/** Límites aplicables a un proyecto concreto (privado o de organización). */
export interface PMProjectLimits {
	/** Issues máximos por proyecto. */
	maxIssuesPerProject: number;
	/** Sprints máximos por proyecto. */
	maxSprintsPerProject: number;
	/** Milestones máximos por proyecto. */
	maxMilestonesPerProject: number;
}

/** Cuotas por usuario (recursos personales: proyectos privados). */
export interface PMUserTierLimits extends PMProjectLimits {
	/** Proyectos privados que un usuario puede crear (visibility=private). */
	maxPrivateProjectsPerUser: number;
}

/** Cuotas por organización (recursos de la org: tableros de organización). */
export interface PMOrgTierLimits extends PMProjectLimits {
	/** Proyectos que una organización puede contener. */
	maxProjectsPerOrg: number;
}

const USER_LIMITS: Record<AccountTier, PMUserTierLimits> = {
	free: {
		maxPrivateProjectsPerUser: 2,
		maxIssuesPerProject: 30,
		maxSprintsPerProject: 2,
		maxMilestonesPerProject: 2,
	},
	pro: {
		maxPrivateProjectsPerUser: 20,
		maxIssuesPerProject: 1000,
		maxSprintsPerProject: 50,
		maxMilestonesPerProject: 50,
	},
	plus: {
		maxPrivateProjectsPerUser: 200,
		maxIssuesPerProject: 100000,
		maxSprintsPerProject: 1000,
		maxMilestonesPerProject: 1000,
	},
};

const ORG_LIMITS: Record<OrganizationTier, PMOrgTierLimits> = {
	default: {
		maxProjectsPerOrg: 2,
		maxIssuesPerProject: 30,
		maxSprintsPerProject: 2,
		maxMilestonesPerProject: 2,
	},
	team: {
		maxProjectsPerOrg: 50,
		maxIssuesPerProject: 1000,
		maxSprintsPerProject: 50,
		maxMilestonesPerProject: 50,
	},
	enterprise: {
		maxProjectsPerOrg: 1000,
		maxIssuesPerProject: 100000,
		maxSprintsPerProject: 1000,
		maxMilestonesPerProject: 1000,
	},
};

/** Límites personales del tier de cuenta. */
export function getPMUserTierLimits(tier: AccountTier = "free"): PMUserTierLimits {
	return USER_LIMITS[tier] ?? USER_LIMITS.free;
}

/** Límites agregados del tier de organización. */
export function getPMOrgTierLimits(tier: OrganizationTier = "default"): PMOrgTierLimits {
	return ORG_LIMITS[tier] ?? ORG_LIMITS.default;
}
