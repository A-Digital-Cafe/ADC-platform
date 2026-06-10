import type { AuthenticatedUserInfo } from "../types.js";
import { CRUDXAction } from "@common/types/Actions.ts";
import { RESOURCE_MAP } from "@common/types/resources.ts";
import type { ISessionVerifier } from "@common/types/identity/SessionVerifier.ts";

const ACTION_NAMES: Record<number, string> = Object.fromEntries(Object.entries(CRUDXAction).map(([key, value]) => [value, key]));

function humanizeScope(resource: string, scope: number, fallback: string): string {
	if (scope === 0) return "NONE";

	const scopeDefs = RESOURCE_MAP.get(resource)?.scopes ?? [];
	const exactScope = scopeDefs.find((scopeDef) => scopeDef.value === scope);
	if (exactScope) return exactScope.key.toUpperCase();

	const matchedScopes = scopeDefs
		.filter((scopeDef) => scopeDef.value !== 0 && (scope & scopeDef.value) === scopeDef.value)
		.sort((left, right) => left.value - right.value)
		.map((scopeDef) => scopeDef.key.toUpperCase());

	return matchedScopes.length > 0 ? matchedScopes.join("|") : fallback;
}

function humanizePermission(perm: string): string {
	const parts = perm.split(".");
	if (parts.length !== 3) return perm;

	const [resource, scopeStr, actionStr] = parts;
	const scope = Number(scopeStr);
	const action = Number(actionStr);
	if (Number.isNaN(scope) || Number.isNaN(action)) return perm;

	const readableScope = humanizeScope(resource, scope, scopeStr);
	const readableAction = ACTION_NAMES[action] ?? actionStr;
	return `${resource}.${readableScope}.${readableAction} (scope: ${scope}, action: ${action})`;
}

/**
 * Verifica si un usuario tiene al menos uno de los permisos requeridos.
 * @param user - El objeto de usuario con sus permisos.
 * @param requiredPermissions - Una lista de strings de permisos a verificar.
 * @returns `true` si el usuario tiene al menos uno de los permisos, `false` en caso contrario.
 */
function checkUserPermissions(user: AuthenticatedUserInfo, requiredPermissions: string[]): boolean {
	const userPermissions = new Set(user.permissions || []);

	return requiredPermissions.some((perm) => {
		// 1. Match exacto
		if (userPermissions.has(perm)) return true;
		// 2. Wildcard parcial (e.g. "identity.4.*")
		const wildcardPerm = perm.split(".").slice(0, -1).join(".") + ".*";
		if (userPermissions.has(wildcardPerm)) return true;
		// 3. Super-wildcard
		if (userPermissions.has("*")) return true;
		// 4. Bitwise: "identity.127.15" o "*.127.15" cubre "identity.4.1"
		const reqParts = perm.split(".");
		if (reqParts.length === 3) {
			const reqScope = Number(reqParts[1]);
			const reqAction = Number(reqParts[2]);
			if (!Number.isNaN(reqScope) && !Number.isNaN(reqAction)) {
				for (const up of userPermissions) {
					const upParts = up.split(".");
					if (upParts.length !== 3) continue;
					if (upParts[0] !== reqParts[0] && upParts[0] !== "*") continue;
					const upScope = Number(upParts[1]);
					const upAction = Number(upParts[2]);
					if (Number.isNaN(upScope) || Number.isNaN(upAction)) continue;
					if ((upScope & reqScope) === reqScope && (upAction & reqAction) === reqAction) return true;
				}
			}
		}
		return false;
	});
}

/**
 * Crea la función de validación de permisos para inyectar en los decoradores.
 * @param getSessionManager - Una función que devuelve la instancia de SessionManagerService.
 * @returns Una función asíncrona que valida un token contra una lista de permisos.
 */
export function createPermissionValidator(getSessionManager: () => ISessionVerifier | null) {
	return async (
		token: string | null,
		requiredPermissions: string[]
	): Promise<{
		valid: boolean;
		user: AuthenticatedUserInfo | null;
		error?: string;
	}> => {
		const sessionManager = getSessionManager();

		// Si no hay permisos requeridos, es público
		if (requiredPermissions.length === 0) {
			// Intentar obtener usuario si hay token (opcional)
			if (token && sessionManager) {
				const result = await sessionManager.verifyToken(token);
				if (result.valid && result.session) {
					return { valid: true, user: result.session.user };
				}
			}
			return { valid: true, user: null };
		}

		// Permisos requeridos - necesitamos token válido
		if (!token) {
			return { valid: false, user: null, error: "Token de autenticación requerido" };
		}

		if (!sessionManager) {
			return { valid: false, user: null, error: "Sistema de autenticación no disponible" };
		}

		const result = await sessionManager.verifyToken(token);

		if (!result.valid || !result.session) {
			return { valid: false, user: null, error: result.error || "Token inválido o expirado" };
		}

		const user = result.session.user;
		const hasPermission = checkUserPermissions(user, requiredPermissions);

		if (!hasPermission) {
			const readable = requiredPermissions.map(humanizePermission);
			return {
				valid: false,
				user,
				error: `Permisos insuficientes. Requerido: ${readable.join(" o ")}`,
			};
		}

		return { valid: true, user };
	};
}
