import { SessionUser } from "@common/types/identity/Session";
import { IdentityScopes } from "@common/types/identity/permissions";
import { hasBitfieldPermission } from "@common/utils/perms";
import { AppMenuItem } from "./adc-apps-menu";
import { IS_DEV } from "../../../utils/url.js";

const host = () => globalThis.location?.hostname ?? "localhost";
const proto = () => globalThis.location?.protocol ?? "http:";
function appUrl(devPort: number, prodHostname: string): string {
	return IS_DEV ? `${proto()}//${host()}:${devPort}` : `${proto()}//${prodHostname}`;
}

/** Built-in app definitions */
export const DEFAULT_APPS: AppMenuItem[] = [
	{ id: "community", name: "Community", url: appUrl(3010, "community.adigitalcafe.com") },
	{ id: "identity", name: "Identity", url: appUrl(3014, "identity.adigitalcafe.com"), requires: canAccessIdentity },
	{ id: "projects", name: "Projects", url: appUrl(3018, "projects.adigitalcafe.com") },
];

/** Identity: solo admin, admin de organización o security_manager (detectado por permiso `users` READ). */
function canAccessIdentity(user: SessionUser | undefined): boolean {
	if (!user) return false;
	if (user.isAdmin || user.isOrgAdmin) return true;
	return hasBitfieldPermission(user.perms, `identity.15.${IdentityScopes.ALL}`);
}
