/**
 * Helper de permisos para adc-org-management
 * Trabaja sobre `Permission[]` (bitfield) como lo expone `SessionUser.perms`
 */

import { P } from "@common/types/Permissions.js";
import { hasBitfieldPermission } from "@common/utils/perms.js";
import type { Permission } from "@common/types/identity/Permission.js";

export { hasBitfieldPermission as hasPermission };

/**
 * Verifica si el usuario puede gestionar organizaciones (admin)
 * Requiere permiso P.IDENTITY.ORGANIZATIONS.READ
 */
export const canManageOrganizations = (perms?: readonly Permission[]) =>
	hasBitfieldPermission(perms, P.IDENTITY.ORGANIZATIONS.READ);

/**
 * Verifica si el usuario puede escribir/modificar organizaciones
 * Requiere permiso P.IDENTITY.ORGANIZATIONS.WRITE
 */
export const canWriteOrganizations = (perms?: readonly Permission[]) =>
	hasBitfieldPermission(perms, P.IDENTITY.ORGANIZATIONS.WRITE);
