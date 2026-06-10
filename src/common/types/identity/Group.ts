import { Permission } from "./Permission.js";

export interface ClientGroup {
	id: string;
	name: string;
	description?: string;
	orgId?: string | null;
}

/**
 * Grupo de usuarios
 */
export interface Group extends ClientGroup {
	roleIds: string[];
	permissions?: Permission[];
	/** Organización a la que pertenece (null = global) */
	orgId?: string | null;
	metadata?: Record<string, any>;
	createdAt: Date;
	updatedAt: Date;
}
