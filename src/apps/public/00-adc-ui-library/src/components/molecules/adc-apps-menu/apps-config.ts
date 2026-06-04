import { SessionUser } from "@common/types/identity/Session";
import { IdentityScopes } from "@common/types/identity/permissions";
import { hasBitfieldPermission } from "@common/utils/perms";
import { AppMenuItem } from "./adc-apps-menu";
import { getUrl } from "../../../utils/url.js";

/** Built-in app definitions */
export const DEFAULT_APPS: AppMenuItem[] = [
	{ id: "community", name: "Community", url: getUrl(3010, "community.adigitalcafe.com") },
	{ id: "identity", name: "Identity", url: getUrl(3014, "identity.adigitalcafe.com"), requires: canAccessIdentity },
	{ id: "projects", name: "Projects", url: getUrl(3018, "projects.adigitalcafe.com") },
	{ id: "mail", name: "Mail", url: getUrl(3030, "mail.adigitalcafe.com") },
];

/** Identity: solo admin, admin de organización o security_manager (detectado por permiso `users` READ). */
function canAccessIdentity(user: SessionUser | undefined): boolean {
	if (!user) return false;
	if (user.isAdmin || user.isOrgAdmin) return true;
	return hasBitfieldPermission(user.perms, `identity.15.${IdentityScopes.ALL}`);
}
