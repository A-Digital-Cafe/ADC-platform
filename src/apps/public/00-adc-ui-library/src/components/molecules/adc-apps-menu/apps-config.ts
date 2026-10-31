import { SessionUser } from "@common/types/identity/Session";
import { IdentityScopes } from "@common/types/identity/permissions";
import { hasBitfieldPermission } from "@common/utils/perms";
import { roleKey } from "@common/utils/ui-access";
import { SUMI_APP_ROLES } from "@common/types/sumi/access";
import { AppMenuItem } from "./adc-apps-menu";
import { getUrl } from "@common/utils/url-utils.js";

/** Built-in app definitions (`moduleName` = nombre base del app en el kernel, para ocultarla si está caída/deshabilitada) */
export const DEFAULT_APPS: AppMenuItem[] = [
	{ id: "community", name: "Community", url: getUrl(3010, "community.adigitalcafe.com"), moduleName: "community-home" },
	{ id: "identity", name: "Identity", url: getUrl(3014, "identity.adigitalcafe.com"), requires: canAccessIdentity, moduleName: "adc-identity" },
	{ id: "projects", name: "Projects", url: getUrl(3018, "projects.adigitalcafe.com"), moduleName: "adc-project-manager" },
	{ id: "mail", name: "Mail", url: getUrl(3030, "email.adigitalcafe.com"), moduleName: "adc-mail" },
	{ id: "drive", name: "Drive", url: getUrl(3032, "drive.adigitalcafe.com"), moduleName: "adc-drive" },
	{
		id: "image-editor",
		name: "Editor de imágenes",
		url: getUrl(3034, "editor.adigitalcafe.com"),
		moduleName: "adc-image-editor",
	},
	{ id: "gen", name: "Generadores", url: getUrl(3050, "gen.adigitalcafe.com"), moduleName: "adc-generators" },
	{ id: "sumi", name: "Sumi", url: getUrl(3052, "sumi.adigitalcafe.com"), requires: canAccessSumi, moduleName: "adc-sumi" },
];

/** Identity: solo admin, admin de organización o security_manager (detectado por permiso `users` READ). */
function canAccessIdentity(user: SessionUser | undefined): boolean {
	if (!user) return false;
	if (user.isAdmin || user.isOrgAdmin) return true;
	return hasBitfieldPermission(user.perms, `identity.15.${IdentityScopes.ALL}`);
}

const SUMI_ROLE_KEYS = new Set(SUMI_APP_ROLES.map(roleKey));

/**
 * Sumi: Admin global o un rol de Sumi, en contexto personal. Mismo criterio que el gate de la
 * página (`uiModule.access` de `adc-sumi`, por nombre de rol): un rol propio con permisos `sumi`
 * no aparece hasta sumarlo a `SUMI_APP_ROLES` y al `config.json`.
 */
function canAccessSumi(user: SessionUser | undefined): boolean {
	if (!user || user.orgId) return false;
	if (user.isAdmin) return true;
	return (user.roles ?? []).some((role) => SUMI_ROLE_KEYS.has(roleKey(role)));
}
