import { Permission } from "./Permission.js";

export interface BaseRole {
	name: string;
	description: string;
	permissions: Permission[];
}

/**
 * Definición de rol
 */
export interface Role extends BaseRole {
	id: string;
	isCustom: boolean;
	/** Organización a la que pertenece (null = global/predefinido) */
	orgId?: string | null;
	createdAt: Date;
}
