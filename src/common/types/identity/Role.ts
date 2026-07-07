import { Permission } from "./Permission.js";

/**
 * Jerarquía por defecto para roles sin `hierarchy` (roles custom pre-existentes).
 * Equivale al nivel de un usuario estándar.
 */
export const DEFAULT_ROLE_HIERARCHY = 100;

/** Niveles de jerarquía de los roles del sistema (mayor = más autoridad). */
export const RoleHierarchy = {
	SYSTEM: 1000,
	ADMIN: 900,
	MANAGER: 500,
	MEMBER: 100,
} as const;

/** Jerarquía efectiva de un rol (fallback para documentos sin el campo). */
export function roleHierarchy(role: { hierarchy?: number | null } | null | undefined): number {
	return role?.hierarchy ?? DEFAULT_ROLE_HIERARCHY;
}

export interface BaseRole {
	name: string;
	description: string;
	permissions: Permission[];
	/**
	 * Orden del rol (mayor = más autoridad). Un actor sólo puede gestionar
	 * usuarios/roles cuya jerarquía sea **estrictamente menor** que la suya,
	 * y nunca a sí mismo (ver guards en IdentityManagerService).
	 */
	hierarchy?: number;
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
	updatedAt?: Date;
}
