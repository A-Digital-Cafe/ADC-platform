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
	/** RoleManager interno (sin auth) para crear los roles predefinidos de la org dev. */
	roles: RoleManager;
	logger: ILogger;
}

/** Marca que identifica lo creado por el dev-seed (usuarios y org). */
const DEV_SEED_MARKER = "dev-seed";

type DevPurgeDeps = Pick<DevSeederDeps, "userModel" | "roleModel" | "orgModel" | "logger">;

/**
 * Purga los artefactos del dev-seed (usuarios, org dev y sus roles). Solo se
 * invoca FUERA de `development` (ver `IdentityManagerService.start`): si una BD
 * sembrada en dev llega a producción, estos accesos con credenciales conocidas
 * se eliminan en cada arranque. Idempotente y acotado a lo marcado
 * `createdVia: "dev-seed"` (+ roles por `orgId`); nunca toca lo global real.
 */
export async function purgeDevUsers(deps: DevPurgeDeps): Promise<void> {
	const { userModel, roleModel, orgModel, logger } = deps;

	const users = await userModel.deleteMany({ "metadata.createdVia": DEV_SEED_MARKER });
	const org = await orgModel.deleteMany({ orgId: DEV_ORG_ID, "metadata.createdVia": DEV_SEED_MARKER });
	// Roles de la org dev (los globales reales tienen orgId null).
	const roles = await roleModel.deleteMany({ orgId: DEV_ORG_ID });

	const removed = (users.deletedCount ?? 0) + (org.deletedCount ?? 0) + (roles.deletedCount ?? 0);
	if (removed > 0) {
		logger.logWarn(
			`[DevSeed] Purgados artefactos de dev fuera de development: ${users.deletedCount ?? 0} usuario(s), ` +
				`${org.deletedCount ?? 0} org, ${roles.deletedCount ?? 0} rol(es).`
		);
	}
}

/**
 * Siembra usuarios de prueba con sus roles. Solo se invoca en
 * `NODE_ENV=development` (ver `IdentityManagerService.start`).
 *
 * Idempotente: en cada arranque reasegura la org dev, sus roles predefinidos y
 * los usuarios de `defaults/devUsers.ts` (reseteando credenciales/roles). Para
 * sumar un usuario, agregá una entrada a `DEV_USERS`.
 *
 * Los roles de la org dev se crean en la BD local (con su `orgId`) porque
 * `PermissionManager` resuelve roles/orgs desde los modelos locales.
 */
export async function seedDevUsers(deps: DevSeederDeps): Promise<void> {
	const { userModel, roleModel, orgModel, roles, logger } = deps;

	// 1. Org de desarrollo con orgId estable (= slug) para login directo.
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

	// 2. Roles predefinidos de la org en la BD local.
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
