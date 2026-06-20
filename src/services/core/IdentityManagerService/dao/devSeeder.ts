import type { Model } from "mongoose";
import type { ILogger } from "../../../../interfaces/utils/ILogger.js";
import type { User } from "@common/types/identity/User.ts";
import type { Role } from "@common/types/identity/Role.ts";
import type { Organization } from "@common/types/identity/Organization.ts";
import { generateId, hashPassword } from "@common/utils/crypto.ts";
import type { RoleManager } from "./roles.js";
import { DEV_USERS, DEV_ORG_ID, DEV_ORG_SLUG, type DevUserSeed } from "../defaults/devUsers.ts";

interface DevSeederDeps {
	userModel: Model<User>;
	roleModel: Model<Role>;
	orgModel: Model<Organization>;
	/** RoleManager (interno, sin auth) para crear los roles predefinidos de la org en la BD local. */
	roles: RoleManager;
	logger: ILogger;
}

/**
 * Siembra usuarios de prueba con roles concretos. **Solo** se invoca en
 * `NODE_ENV=development` (ver `IdentityManagerService.start`).
 *
 * Es idempotente: en cada arranque reasegura la organización de desarrollo, sus
 * roles predefinidos y los usuarios declarados en `defaults/devUsers.ts`,
 * reseteando credenciales/roles a lo declarado. Agregar un usuario de dev con
 * roles específicos = agregar una entrada a `DEV_USERS` (no hace falta tocar
 * este archivo).
 *
 * Nota: el `PermissionManager` resuelve roles y orgs desde los modelos locales,
 * por eso los roles de la org dev se crean en la BD local (con su `orgId`) y la
 * membresía del usuario referencia esos `roleIds`.
 */
export async function seedDevUsers(deps: DevSeederDeps): Promise<void> {
	const { userModel, roleModel, orgModel, roles, logger } = deps;

	// 1. Organización de desarrollo con orgId estable (= slug) para login directo.
	await orgModel.updateOne(
		{ orgId: DEV_ORG_ID },
		{
			$setOnInsert: { orgId: DEV_ORG_ID, createdAt: new Date() },
			$set: {
				slug: DEV_ORG_SLUG,
				region: "default/default",
				tier: "default",
				status: "active",
				approved: true,
				metadata: { createdVia: "dev-seed" },
				updatedAt: new Date(),
			},
		},
		{ upsert: true }
	);

	// 2. Roles predefinidos de la org en la BD local (donde los resuelve PermissionManager).
	await roles.initializePredefinedRoles(DEV_ORG_ID);

	// Resuelve roleIds por nombre dentro de un contexto (orgId null = global).
	const resolveRoleIds = async (names: readonly string[] | undefined, orgId: string | null): Promise<string[]> => {
		const ids: string[] = [];
		for (const name of names ?? []) {
			const doc = await roleModel.findOne({ name, orgId }, { id: 1, _id: 0 }).lean();
			if (doc?.id) ids.push(doc.id);
			else logger.logWarn(`[DevSeed] Rol no encontrado: "${name}" (orgId=${orgId ?? "global"})`);
		}
		return ids;
	};

	// 3. Upsert de cada usuario de dev.
	for (const seed of DEV_USERS) {
		await upsertDevUser(seed);
	}

	async function upsertDevUser(seed: DevUserSeed): Promise<void> {
		const roleIds = await resolveRoleIds(seed.globalRoles, null);
		const orgRoleIds = await resolveRoleIds(seed.orgRoles, DEV_ORG_ID);
		const orgMemberships = orgRoleIds.length ? [{ orgId: DEV_ORG_ID, roleIds: orgRoleIds, joinedAt: new Date() }] : [];

		await userModel.updateOne(
			{ username: seed.username },
			{
				$setOnInsert: { id: generateId(), username: seed.username, createdAt: new Date() },
				$set: {
					email: seed.email ?? `${seed.username}@dev.local`,
					passwordHash: hashPassword(seed.password),
					roleIds,
					groupIds: [],
					orgMemberships,
					isActive: true,
					metadata: { createdVia: "dev-seed" },
					updatedAt: new Date(),
				},
			},
			{ upsert: true }
		);

		const scopes = [
			...(seed.globalRoles?.length ? [`global:[${seed.globalRoles.join(", ")}]`] : []),
			...(seed.orgRoles?.length ? [`${DEV_ORG_SLUG}:[${seed.orgRoles.join(", ")}]`] : []),
		].join(" ");
		logger.logOk(`[DevSeed] Usuario dev listo: ${seed.username} / ${seed.password} → ${scopes || "sin roles"}`);
	}
}
