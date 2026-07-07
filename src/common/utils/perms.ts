import { Permission } from "@common/types/identity/Permission.js";
import { PMScopes, PM_RESOURCE_NAME } from "@common/types/project-manager/permissions.js";

/**
 * Bit `SELF` por recurso: cuando está presente en el permiso, sólo aplica si
 * `opts.selfId === opts.ownerId`. `identity.SELF` NO se lista porque es un
 * scope regular (el propio perfil).
 */
const SELF_MODIFIER_BY_RESOURCE: Record<string, number> = {
	[PM_RESOURCE_NAME]: PMScopes.SELF,
};

interface HasPermissionOpts {
	selfId?: string;
	ownerId?: string;
}

export function hasPermission(
	perms: readonly Permission[] | null | undefined,
	resource: string,
	requiredAction: number,
	requiredScope: number,
	opts?: HasPermissionOpts
): boolean {
	if (!perms?.length) return false;

	const selfBit = SELF_MODIFIER_BY_RESOURCE[resource] ?? 0;
	const isSelf = opts?.selfId !== undefined && opts?.ownerId !== undefined && opts.selfId === opts.ownerId;

	for (const p of perms) {
		if (p.resource !== resource && p.resource !== "*") continue;
		if ((p.action & requiredAction) !== requiredAction) continue;

		// 1) Vía formal: el scope cubre el requerido sin necesidad del bit SELF.
		//    SELF es un modificador aditivo y nunca debe invalidar un permiso
		//    formal ya satisfecho (p. ej., cuando perms del mismo nivel se OR-mergean).
		const effectiveScope = p.scope & ~selfBit;
		if ((effectiveScope & requiredScope) === requiredScope) return true;

		// 2) Vía SELF: el permiso sólo cubre el requerido gracias al bit SELF
		//    y el actor es el owner del recurso.
		if (selfBit !== 0 && (p.scope & selfBit) !== 0 && isSelf && (p.scope & requiredScope) === requiredScope) {
			return true;
		}
	}
	return false;
}

/**
 * @public Chequea un permiso bitfield usando una constante de `P` (e.g. `P.COMMUNITY.SOCIAL.WRITE`).
 *
 * Formato de `required`: `"resource.scope.action"` (e.g. `"community.5.2"`).
 *
 * Pensado para consumidores de `SessionUser.perms` que quieran usar las constantes
 * tipadas de `P` sin convertir manualmente a resource/action/scope.
 */
export function hasBitfieldPermission(perms: readonly Permission[] | null | undefined, required: string, opts?: HasPermissionOpts): boolean {
	if (!perms?.length) return false;

	const dot1 = required.indexOf(".");
	const dot2 = required.indexOf(".", dot1 + 1);
	if (dot1 === -1 || dot2 === -1) return false;

	const resource = required.slice(0, dot1);
	const reqScope = Number(required.slice(dot1 + 1, dot2));
	const reqAction = Number(required.slice(dot2 + 1));
	if (!Number.isFinite(reqScope) || !Number.isFinite(reqAction)) return false;

	return hasPermission(perms, resource, reqAction, reqScope, opts);
}
