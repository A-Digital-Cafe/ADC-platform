import { Permission } from "./Permission.js";

/**
 * Membresía por organización
 */
export interface OrgMembership {
	orgId: string;
	roleIds: string[];
	joinedAt: Date;
}

/**
 * Cuenta vinculada de un proveedor externo (Discord, Google, etc.)
 */
export interface LinkedAccount {
	provider: string;
	providerId: string;
	providerUsername?: string;
	providerAvatar?: string;
	status: "linked" | "unlinked";
	linkedAt: Date;
	unlinkedAt?: Date;
}

/**
 * @public Usuario del sistema (frontend)
 */
export interface ClientUser {
	id: string;
	username: string;
	email?: string;
	avatar?: string | null;
	roleIds: string[];
	groupIds: string[];
	permissions?: Permission[];
	orgMemberships?: OrgMembership[];
	linkedAccounts?: LinkedAccount[];
	metadata?: Record<string, any>;
	isActive: boolean;
	createdAt: Date;
	updatedAt: Date;
	lastLogin?: Date;
}

/**
 * Usuario del sistema (backend)
 */
export interface User extends ClientUser {
	passwordHash: string;
}

/**
 * Origen de una baja programada (`metadata.deletionReason`). Sólo `"self"` la cancela la propia
 * persona; `"admin"` y `"ban"` se revierten por acción administrativa (reactivación / unban).
 */
export type DeletionReason = "self" | "admin" | "ban";
