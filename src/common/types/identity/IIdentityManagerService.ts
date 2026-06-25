/**
 * Contrato público del **IdentityManagerService** (clase principal).
 *
 * Vive en `@common` para que servicios, apps y presets consuman Identity por
 * **interfaz** (sin importar la clase concreta de `@services`). La clase concreta
 * hace `implements IIdentityManagerService`: cualquier divergencia de firma rompe
 * el build.
 *
 * Sólo se define el contrato de la **clase del servicio**; los managers y tipos
 * derivados se reutilizan tal cual desde la implementación (no se duplican).
 */

import type { UserManager, RoleManager, GroupManager, SystemManager, RegionManager, OrgManager, PermissionManager } from "@services/core/IdentityManagerService/dao/index.js";
import type { NotifyManager } from "@services/core/IdentityManagerService/notify.js";
import type { IdentityInternalApi, IdentityAvatarApi, IdentityDiscordApi } from "@services/core/IdentityManagerService/internal.js";
import type { IdentityStats, OrgScopedManagers } from "@services/core/IdentityManagerService/types.js";
import type { IAuthVerifier } from "../auth-verifier.ts";
import type { CapabilityToken } from "../../security/Capability.ts";

/** Superficie pública del manager de usuarios (sin las primitivas pre-auth). */
export type PublicUserManager = Omit<UserManager, "authenticate" | "verifyUserPassword">;

/**
 * Interfaz pública del IdentityManagerService. Los getters de managers exponen los
 * managers concretos; las superficies `_internal*` están gateadas por scope y
 * devuelven vistas acotadas.
 */
export interface IIdentityManagerService {
	readonly name: string;

	readonly users: PublicUserManager;
	readonly roles: RoleManager;
	readonly groups: GroupManager;
	readonly system: SystemManager;
	readonly organizations: OrgManager;
	readonly regions: RegionManager;
	readonly permissions: PermissionManager;

	createAuthVerifier(): IAuthVerifier;
	getStats(token?: string): Promise<IdentityStats>;
	forOrg(orgIdOrSlug: string, mode?: "read" | "write", token?: string): Promise<OrgScopedManagers>;

	_internal(token: CapabilityToken): IdentityInternalApi;
	_internalAvatar(token: CapabilityToken): IdentityAvatarApi;
	_internalDiscord(token: CapabilityToken): IdentityDiscordApi;
	notifications(token: CapabilityToken): NotifyManager;
}
