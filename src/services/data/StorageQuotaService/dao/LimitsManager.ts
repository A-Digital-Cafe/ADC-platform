import { randomUUID } from "node:crypto";
import type { Model } from "mongoose";
import type { ILogger } from "@interfaces/utils/ILogger.js";
import { UNLIMITED_BYTES, type QuotaSubject, type QuotaSubjectType, type StorageLimitOverride } from "@common/types/storage/quota.ts";
import {
	STORAGE_USER_TIER_LIMITS,
	STORAGE_ORG_TIER_LIMITS,
	getOrgMemberDefaultBytes,
	type QuotaScope,
} from "@common/types/tiers/storage.ts";
import type { AccountTier } from "@common/types/tiers.ts";
import type { OrganizationTier } from "@common/types/identity/Organization.ts";
import { StorageError } from "@common/types/custom-errors/StorageError.ts";
import LRUCache from "@adc/utils/performance/LRUCache.ts";

/** Fuente mínima de datos de identity (managers internos, sin auth). */
export interface IdentitySource {
	getUser(userId: string): Promise<{
		roleIds?: string[];
		metadata?: { accountTier?: string } | null;
		orgMemberships?: Array<{ orgId: string; roleIds: string[] }>;
	} | null>;
	getOrganization(orgIdOrSlug: string): Promise<{ orgId?: string; tier?: string } | null>;
	getRole(roleId: string): Promise<{ orgId?: string | null } | null>;
}

export interface UpsertOverrideInput {
	subjectType: QuotaSubjectType;
	subjectId: string;
	limitBytes: number;
}

/** Contexto del actor que administra overrides (derivado del token, nunca del body). */
export interface OverrideActorCtx {
	userId: string;
	/** null/undefined = contexto global (admin global). */
	orgId?: string | null;
}

/** Límite efectivo + contexto/tier resuelto (alimenta los mínimos por app). */
export interface QuotaProfile {
	effectiveLimit: number;
	scope: QuotaScope;
}

const CACHE_TTL_MS = 30_000;

interface CachedProfile {
	value: QuotaProfile;
	expiresAt: number;
}

/**
 * Resolución del perfil de cuota (límite efectivo + tier del contexto) y
 * administración de overrides.
 *
 * Precedencia con org activa: override de usuario (clamp ≤ org) → máximo de
 * overrides de sus roles en esa org (clamp ≤ org) → default por miembro
 * (override `org-members-default` ?? tier de la org; clamp ≤ org) → límite de
 * la org (override de org global ?? tier). Sin org: override global de usuario
 * → máximo de overrides de roles globales → tier de cuenta.
 *
 * El clamp al límite de la org se aplica también en lectura: reducir el límite
 * de una org degrada automáticamente los overrides internos ya asignados.
 */
export class LimitsManager {
	readonly #model: Model<StorageLimitOverride>;
	readonly #identity: IdentitySource;
	readonly #logger: ILogger;
	readonly #cache = new LRUCache<string, CachedProfile>(2000);

	constructor(model: Model<StorageLimitOverride>, identity: IdentitySource, logger: ILogger) {
		this.#model = model;
		this.#identity = identity;
		this.#logger = logger;
	}

	async resolveQuotaProfile(subject: QuotaSubject): Promise<QuotaProfile> {
		const orgId = subject.orgId ?? null;
		const cacheKey = `${subject.userId}|${orgId ?? ""}`;
		const cached = this.#cache.get(cacheKey);
		if (cached && cached.expiresAt > Date.now()) return cached.value;

		let value: QuotaProfile;
		try {
			value = orgId ? await this.#resolveOrgScoped(subject.userId, orgId) : await this.#resolveGlobal(subject.userId);
		} catch (e) {
			// Tolerante a fallos: ante un error de identity, caer al tier base del contexto.
			this.#logger.logWarn(`StorageQuota: error resolviendo límite de ${subject.userId}: ${(e as Error).message}`);
			value = orgId
				? { effectiveLimit: STORAGE_ORG_TIER_LIMITS.default, scope: { kind: "org", tier: "default" } }
				: { effectiveLimit: STORAGE_USER_TIER_LIMITS.free, scope: { kind: "personal", tier: "free" } };
		}
		this.#cache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL_MS });
		return value;
	}

	/** Límite total de una organización (override global de org ?? tier). */
	async resolveOrgLimit(orgId: string): Promise<number> {
		return (await this.#orgLimitAndTier(orgId)).limit;
	}

	/** Default por miembro de una org: tier, override y valor efectivo (para administración). */
	async getOrgMemberDefault(orgId: string): Promise<{ orgLimit: number; tierBytes: number; overrideBytes: number | null; effectiveBytes: number }> {
		const { limit: orgLimit, tier } = await this.#orgLimitAndTier(orgId);
		const override = await this.#findOverride("org-members-default", orgId, orgId);
		const tierBytes = getOrgMemberDefaultBytes(tier);
		const base = override?.limitBytes ?? tierBytes;
		const effectiveBytes = base === UNLIMITED_BYTES ? orgLimit : clampToOrg(base, orgLimit);
		return { orgLimit, tierBytes, overrideBytes: override?.limitBytes ?? null, effectiveBytes };
	}

	/** Tier y límite de la org en una sola resolución (el tier alimenta mins y defaults). */
	async #orgLimitAndTier(orgId: string): Promise<{ limit: number; tier: OrganizationTier }> {
		const org = await this.#identity.getOrganization(orgId);
		if (!org) throw new StorageError(404, "ORG_NOT_FOUND", "Organización no encontrada");
		const tier = (org.tier as OrganizationTier) ?? "default";
		const orgOverride = await this.#findOverride("org", orgId, null);
		const limit = orgOverride?.limitBytes ?? STORAGE_ORG_TIER_LIMITS[tier] ?? STORAGE_ORG_TIER_LIMITS.default;
		return { limit, tier };
	}

	async #resolveOrgScoped(userId: string, orgId: string): Promise<QuotaProfile> {
		const { limit: orgLimit, tier } = await this.#orgLimitAndTier(orgId);
		const scope: QuotaScope = { kind: "org", tier };

		const userOverride = await this.#findOverride("user", userId, orgId);
		if (userOverride) return { effectiveLimit: clampToOrg(userOverride.limitBytes, orgLimit), scope };

		const user = await this.#identity.getUser(userId);
		const roleIds = user?.orgMemberships?.find((m) => m.orgId === orgId)?.roleIds ?? [];
		const roleMax = await this.#maxRoleOverride(roleIds, orgId);
		if (roleMax !== null) return { effectiveLimit: clampToOrg(roleMax, orgLimit), scope };

		// Default por miembro: override de la org ?? tier; UNLIMITED = sin tope → límite org.
		const memberDefault = await this.#findOverride("org-members-default", orgId, orgId);
		const defaultBytes = memberDefault?.limitBytes ?? getOrgMemberDefaultBytes(tier);
		if (defaultBytes !== UNLIMITED_BYTES) return { effectiveLimit: clampToOrg(defaultBytes, orgLimit), scope };

		return { effectiveLimit: orgLimit, scope };
	}

	async #resolveGlobal(userId: string): Promise<QuotaProfile> {
		const user = await this.#identity.getUser(userId);
		const tier = (user?.metadata?.accountTier as AccountTier) ?? "free";
		const scope: QuotaScope = { kind: "personal", tier };

		const userOverride = await this.#findOverride("user", userId, null);
		if (userOverride) return { effectiveLimit: userOverride.limitBytes, scope };

		const roleMax = await this.#maxRoleOverride(user?.roleIds ?? [], null);
		if (roleMax !== null) return { effectiveLimit: roleMax, scope };

		return { effectiveLimit: STORAGE_USER_TIER_LIMITS[tier] ?? STORAGE_USER_TIER_LIMITS.free, scope };
	}

	/** Máximo de los overrides de una lista de roles; null si ninguno tiene override. */
	async #maxRoleOverride(roleIds: string[], orgId: string | null): Promise<number | null> {
		if (!roleIds.length) return null;
		const overrides = await this.#model.find({ subjectType: "role", subjectId: { $in: roleIds }, orgId }).lean<StorageLimitOverride[]>();
		if (!overrides.length) return null;
		if (overrides.some((o) => o.limitBytes === UNLIMITED_BYTES)) return UNLIMITED_BYTES;
		return Math.max(...overrides.map((o) => o.limitBytes));
	}

	async #findOverride(subjectType: QuotaSubjectType, subjectId: string, orgId: string | null): Promise<StorageLimitOverride | null> {
		return this.#model.findOne({ subjectType, subjectId, orgId }).lean<StorageLimitOverride | null>();
	}

	// ─── Administración de overrides ─────────────────────────────────────────

	async listOverrides(actor: OverrideActorCtx): Promise<StorageLimitOverride[]> {
		// En contexto org, el filtro se fuerza server-side a esa org.
		const filter = actor.orgId ? { orgId: actor.orgId } : {};
		return this.#model.find(filter).sort({ createdAt: -1 }).limit(500).lean<StorageLimitOverride[]>();
	}

	/**
	 * Crea/actualiza un override validando la jerarquía:
	 * - Actor org: solo subjects `user`/`role` de SU org o el `org-members-default`
	 *   propio; `orgId` forzado, `limitBytes` ≤ límite de la org y nunca ilimitado.
	 * - Actor global: cualquier subject, ilimitado permitido.
	 * Para `org-members-default` el doc queda SIEMPRE scoped a la org subject
	 * (también con actor global), para que la resolución org-scoped lo encuentre.
	 */
	async upsertOverride(actor: OverrideActorCtx, input: UpsertOverrideInput): Promise<StorageLimitOverride> {
		this.#validateInput(input);
		const actorOrgId = actor.orgId ?? null;
		const isMembersDefault = input.subjectType === "org-members-default";
		const docOrgId = isMembersDefault ? input.subjectId : actorOrgId;

		if (isMembersDefault) {
			await this.#validateMembersDefaultUpsert(actorOrgId, input);
		} else if (actorOrgId) {
			await this.#validateOrgActorUpsert(actorOrgId, input);
		}

		const now = new Date();
		const doc = await this.#model.findOneAndUpdate(
			{ subjectType: input.subjectType, subjectId: input.subjectId, orgId: docOrgId },
			{
				$set: { limitBytes: input.limitBytes, updatedAt: now },
				$setOnInsert: { id: randomUUID(), createdBy: actor.userId, createdAt: now },
			},
			{ new: true, upsert: true }
		);
		this.#cache.clear();
		return doc.toObject() as StorageLimitOverride;
	}

	async deleteOverride(actor: OverrideActorCtx, overrideId: string): Promise<void> {
		const doc = await this.#model.findOne({ id: overrideId }).lean<StorageLimitOverride | null>();
		if (!doc) throw new StorageError(404, "OVERRIDE_NOT_FOUND", "Override no encontrado");
		// Actor org: solo puede borrar overrides scoped a su org.
		if (actor.orgId && doc.orgId !== actor.orgId) {
			throw new StorageError(403, "ORG_ACCESS_DENIED", "No tienes acceso a este override");
		}
		await this.#model.deleteOne({ id: overrideId });
		this.#cache.clear();
	}

	/** Validación del upsert de `org-members-default` (org actor: solo su org, sin ilimitado; clamp ≤ org). */
	async #validateMembersDefaultUpsert(actorOrgId: string | null, input: UpsertOverrideInput): Promise<void> {
		if (actorOrgId) {
			if (input.subjectId !== actorOrgId) {
				throw new StorageError(403, "ORG_ACCESS_DENIED", "Solo puedes ajustar el default de tu organización");
			}
			if (input.limitBytes === UNLIMITED_BYTES) {
				throw new StorageError(403, "UNLIMITED_FORBIDDEN", "Una organización no puede asignar límites ilimitados");
			}
		}
		// Valida existencia de la org y obtiene el límite para el clamp.
		const orgLimit = await this.resolveOrgLimit(input.subjectId);
		if (input.limitBytes !== UNLIMITED_BYTES && orgLimit !== UNLIMITED_BYTES && input.limitBytes > orgLimit) {
			throw new StorageError(403, "LIMIT_EXCEEDS_ORG", "El límite supera el disponible de la organización", { orgLimit });
		}
	}

	/** Validación del upsert de un actor org sobre subjects user/role de su org. */
	async #validateOrgActorUpsert(actorOrgId: string, input: UpsertOverrideInput): Promise<void> {
		if (input.subjectType === "org") {
			throw new StorageError(403, "GLOBAL_ONLY", "Los límites de organización se administran en contexto global");
		}
		if (input.limitBytes === UNLIMITED_BYTES) {
			throw new StorageError(403, "UNLIMITED_FORBIDDEN", "Una organización no puede asignar límites ilimitados");
		}
		await this.#assertSubjectInOrg(input.subjectType, input.subjectId, actorOrgId);
		const orgLimit = await this.resolveOrgLimit(actorOrgId);
		if (orgLimit !== UNLIMITED_BYTES && input.limitBytes > orgLimit) {
			throw new StorageError(403, "LIMIT_EXCEEDS_ORG", "El límite supera el disponible de la organización", { orgLimit });
		}
	}

	#validateInput(input: UpsertOverrideInput): void {
		if (!input.subjectId || typeof input.subjectId !== "string") {
			throw new StorageError(400, "MISSING_FIELDS", "`subjectId` requerido");
		}
		if (!["user", "org", "role", "org-members-default"].includes(input.subjectType)) {
			throw new StorageError(400, "INVALID_FIELD", "`subjectType` debe ser user|org|role|org-members-default");
		}
		if (
			typeof input.limitBytes !== "number" ||
			!Number.isFinite(input.limitBytes) ||
			!Number.isInteger(input.limitBytes) ||
			(input.limitBytes < 0 && input.limitBytes !== UNLIMITED_BYTES)
		) {
			throw new StorageError(400, "INVALID_FIELD", "`limitBytes` debe ser un entero ≥ 0 o -1 (ilimitado)");
		}
	}

	/** Verifica que el subject (user/role) pertenezca a la org del actor. */
	async #assertSubjectInOrg(subjectType: QuotaSubjectType, subjectId: string, orgId: string): Promise<void> {
		if (subjectType === "user") {
			const user = await this.#identity.getUser(subjectId);
			const isMember = user?.orgMemberships?.some((m) => m.orgId === orgId) ?? false;
			if (!isMember) throw new StorageError(403, "ORG_ACCESS_DENIED", "El usuario no pertenece a tu organización");
			return;
		}
		// role: la fuente de verdad del scope del rol vive en Identity.
		const role = await this.#identity.getRole(subjectId);
		if (role?.orgId !== orgId) {
			throw new StorageError(403, "ORG_ACCESS_DENIED", "El rol no pertenece a tu organización");
		}
	}
}

function clampToOrg(value: number, orgLimit: number): number {
	if (orgLimit === UNLIMITED_BYTES) return value;
	if (value === UNLIMITED_BYTES) return orgLimit;
	return Math.min(value, orgLimit);
}
