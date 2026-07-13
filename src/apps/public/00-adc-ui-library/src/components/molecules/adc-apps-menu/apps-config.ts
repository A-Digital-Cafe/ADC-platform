import { SessionUser } from "@common/types/identity/Session";
import { IdentityScopes } from "@common/types/identity/permissions";
import { hasBitfieldPermission } from "@common/utils/perms";
import { AppMenuItem } from "./adc-apps-menu";
import { getUrl } from "@common/utils/url-utils.js";

/** Built-in app definitions (`moduleName` = nombre base del app en el kernel, para ocultarla si está caída/deshabilitada) */
export const DEFAULT_APPS: AppMenuItem[] = [
	{ id: "community", name: "Community", url: getUrl(3010, "community.adigitalcafe.com"), moduleName: "community-home" },
	{ id: "identity", name: "Identity", url: getUrl(3014, "identity.adigitalcafe.com"), requires: canAccessIdentity, moduleName: "adc-identity" },
	{ id: "projects", name: "Projects", url: getUrl(3018, "projects.adigitalcafe.com"), moduleName: "adc-project-manager" },
	{ id: "mail", name: "Mail", url: getUrl(3030, "mail.adigitalcafe.com"), moduleName: "adc-mail" },
	{ id: "drive", name: "Drive", url: getUrl(3032, "drive.adigitalcafe.com"), moduleName: "adc-drive" },
];

/** Identity: solo admin, admin de organización o security_manager (detectado por permiso `users` READ). */
function canAccessIdentity(user: SessionUser | undefined): boolean {
	if (!user) return false;
	if (user.isAdmin || user.isOrgAdmin) return true;
	return hasBitfieldPermission(user.perms, `identity.15.${IdentityScopes.ALL}`);
}
