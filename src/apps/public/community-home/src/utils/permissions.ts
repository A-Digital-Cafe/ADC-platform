/**
 * Helper de permisos para community-home.
 * Trabaja sobre `Permission[]` (bitfield) tal como lo expone `SessionUser.perms`.
 */

import { P } from "@common/types/Permissions.js";
import { hasBitfieldPermission } from "@common/utils/perms.js";
import type { Permission } from "@common/types/identity/Permission.js";
import type { CRUDXAction } from "@common/types/Actions.js";

export type CRUDXActionValue = (typeof CRUDXAction)[keyof typeof CRUDXAction];

export { hasBitfieldPermission as hasPermission };

export const canComment = (perms?: readonly Permission[]) => hasBitfieldPermission(perms, P.COMMUNITY.SOCIAL.WRITE);

export const canRate = (perms?: readonly Permission[]) => hasBitfieldPermission(perms, P.COMMUNITY.SOCIAL.WRITE);

export const canPublish = (perms?: readonly Permission[]) => hasBitfieldPermission(perms, P.COMMUNITY.PUBLISH_STATUS.WRITE);

export const canEditContent = (perms?: readonly Permission[]) =>
	hasBitfieldPermission(perms, P.COMMUNITY.CONTENT.WRITE) || hasBitfieldPermission(perms, P.COMMUNITY.CONTENT.UPDATE);

export const canDeleteSocial = (perms: readonly Permission[]) => hasBitfieldPermission(perms, P.COMMUNITY.SOCIAL.DELETE);
