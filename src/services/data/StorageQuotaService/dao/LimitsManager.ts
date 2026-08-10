import type { ILogger } from "@interfaces/utils/ILogger.js";
import { UNLIMITED_BYTES, type QuotaSubject, type QuotaSubjectType, type StorageLimitOverride } from "@common/types/storage/quota.ts";
import {
	STORAGE_USER_TIER_LIMITS,
	STORAGE_ORG_TIER_LIMITS,
	STORAGE_TOTAL_FEATURE,
	type QuotaScope,
} from "@common/types/tiers/storage.ts";
import type { AccountTier } from "@common/types/tiers.ts";
import type { OrganizationTier } from "@common/types/identity/Organization.ts";
import { StorageError } from "@common/types/custom-errors/StorageError.ts";
import type { IPlanService } from "@common/types/plans/IPlanService.ts";
import type { PlanOverride } from "@common/types/plans/index.ts";

/** Fuente mínima de datos de identity, sólo para el fallback sin `PlanService`. */
export interface IdentitySource {
	getUser(userId: string): Promise<{ metadata?: { accountTier?: string } | null } | null>;
	getOrganization(orgIdOrSlug: string): Promise<{ orgId?: string; tier?: string } | null>;
}

/** Resolver perezoso del motor de planes; `undefined` = no está cargado. */
export type PlanResolver = () => IPlanService | undefined;

export interface UpsertOverrideInput {
	subjectType: QuotaSubjectType;
	subjectId: string;
	limitBytes: number;
}

/** Filtros y paginación del listado administrativo (la feature ya está fijada a storage). */
export interface StorageOverridesQuery {
	subjectType?: QuotaSubjectType;
	subjectId?: string;
	limit?: number;
	offset?: number;
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
	/**
	 * El límite no sale del plan contratado sino de la degradación por caída del motor de planes.
	 * Lo consume la UI para explicarlo en vez de mostrar una cuota recortada sin motivo.
	 */
	degraded?: boolean;
}

/**
 * Límite de almacenamiento de un sujeto y administración de sus excepciones.
 *
 * **Adaptador, no resolver**: el límite es la feature `storage.total` del catálogo de
 * `PlanService` y los overrides viven en `plan_overrides`; acá sólo se conserva la forma de la API
 * de storage (bytes, `StorageLimitOverride`). La precedencia y el clamp los aplica
 * `EntitlementsManager`.
 *
 * **Fail-open**: sin `PlanService` cae a las matrices de `@common/types/tiers/storage.ts` (sin
 * overrides). La administración, en cambio, responde 503: no hay dónde escribirlos.
 */
export class LimitsManager {
	readonly #identity: IdentitySource;
	readonly #logger: ILogger;
	readonly #plans: PlanResolver;

	constructor(identity: IdentitySource, logger: ILogger, plans: PlanResolver) {
		this.#identity = identity;
		this.#logger = logger;
		this.#plans = plans;
	}

	async resolveQuotaProfile(subject: QuotaSubject): Promise<QuotaProfile> {
		const orgId = subject.orgId ?? null;
		const plans = this.#tryPlans();
		if (plans) {
			try {
				const dto = await plans.entitlements.get({ userId: subject.userId, orgId });
				const limit = dto.features[STORAGE_TOTAL_FEATURE];
				if (typeof limit === "number") {
					const scope: QuotaScope =
						dto.axis === "org" ? { kind: "org", tier: dto.tier as OrganizationTier } : { kind: "personal", tier: dto.tier as AccountTier };
					return { effectiveLimit: limit, scope };
				}
			} catch (e) {
				this.#logger.logWarn(`StorageQuota: PlanService falló resolviendo ${subject.userId}: ${(e as Error).message}`);
			}
		}
		return this.#fallbackProfile(subject.userId, orgId);
	}

	/** Límite total de una organización (el pool compartido, sin mirar a ningún miembro). */
	async resolveOrgLimit(orgId: string): Promise<number> {
		const plans = this.#tryPlans();
		if (plans) {
			try {
				const snapshot = await plans.orgSnapshot(orgId);
				const value = snapshot.values[STORAGE_TOTAL_FEATURE];
				if (typeof value === "number") return value;
			} catch (e) {
				this.#logger.logWarn(`StorageQuota: PlanService falló resolviendo la org ${orgId}: ${(e as Error).message}`);
			}
		}
		const tier = await this.#orgTier(orgId);
		return STORAGE_ORG_TIER_LIMITS[tier] ?? STORAGE_ORG_TIER_LIMITS.default;
	}

	/** Default por miembro de una org: valor del plan, override administrado y efectivo. */
	async getOrgMemberDefault(orgId: string): Promise<{ orgLimit: number; tierBytes: number; overrideBytes: number | null; effectiveBytes: number }> {
		const snapshot = await this.#requirePlans().orgSnapshot(orgId);
		const orgLimit = numberOr(snapshot.values[STORAGE_TOTAL_FEATURE], STORAGE_ORG_TIER_LIMITS.default);
		const effectiveBytes = numberOr(snapshot.memberDefaults[STORAGE_TOTAL_FEATURE], orgLimit);
		const tierBytes = numberOr(snapshot.memberPlanDefaults[STORAGE_TOTAL_FEATURE], UNLIMITED_BYTES);
		const override = snapshot.memberDefaultOverrides[STORAGE_TOTAL_FEATURE];

		return { orgLimit, tierBytes, overrideBytes: typeof override === "number" ? override : null, effectiveBytes };
	}

	// ─── Administración de overrides ─────────────────────────────────────────

	/**
	 * Página de overrides de storage (ver `PlanOverridePage`). Para ubicar uno puntual —el
	 * `org-members-default` de una org— conviene filtrar por sujeto en vez de barrer páginas.
	 */
	async listOverrides(actor: OverrideActorCtx, query: StorageOverridesQuery = {}): Promise<{ items: StorageLimitOverride[]; total: number }> {
		const page = await this.#requirePlans().overridesAdmin.list(actor, { ...query, featureKey: STORAGE_TOTAL_FEATURE });
		return { items: page.items.map(toStorageOverride), total: page.total };
	}

	async upsertOverride(actor: OverrideActorCtx, input: UpsertOverrideInput): Promise<StorageLimitOverride> {
		if (typeof input.limitBytes !== "number" || !Number.isInteger(input.limitBytes) || (input.limitBytes < 0 && input.limitBytes !== UNLIMITED_BYTES)) {
			throw new StorageError(400, "INVALID_FIELD", "`limitBytes` debe ser un entero ≥ 0 o -1 (ilimitado)");
		}
		const doc = await this.#requirePlans().overridesAdmin.upsert(actor, {
			subjectType: input.subjectType,
			subjectId: input.subjectId,
			featureKey: STORAGE_TOTAL_FEATURE,
			value: input.limitBytes,
		});
		return toStorageOverride(doc);
	}

	async deleteOverride(actor: OverrideActorCtx, overrideId: string): Promise<void> {
		await this.#requirePlans().overridesAdmin.remove(actor, overrideId);
	}

	// ─── Internos ────────────────────────────────────────────────────────────

	#tryPlans(): IPlanService | undefined {
		try {
			return this.#plans();
		} catch {
			return undefined;
		}
	}

	/** Igual que `#tryPlans`, pero para operaciones que no tienen fallback posible. */
	#requirePlans(): IPlanService {
		const plans = this.#tryPlans();
		if (!plans) throw new StorageError(503, "QUOTA_UNAVAILABLE", "El motor de planes no está disponible");
		return plans;
	}

	/**
	 * Sin motor de planes: **límites del plan base**, que es lo que prometen los Términos y lo que
	 * ya hacen Drive, PM, correo y el editor de imágenes al degradar. Antes se leía el `accountTier`
	 * del usuario, que contradecía el texto publicado y además puede estar vencido justo cuando el
	 * único servicio que conoce la baja es el que no responde.
	 *
	 * Sólo afecta a **consumo nuevo** —la cuota se chequea al subir, no al leer—, así que nadie
	 * pierde acceso a lo que ya tiene. El `tier` real se conserva en `scope` para que la UI diga de
	 * qué plan se degradó, y `degraded` marca que el número no es el del plan contratado.
	 */
	async #fallbackProfile(userId: string, orgId: string | null): Promise<QuotaProfile> {
		if (orgId) {
			const tier = await this.#orgTier(orgId);
			return { effectiveLimit: STORAGE_ORG_TIER_LIMITS.default, scope: { kind: "org", tier }, degraded: true };
		}
		let tier: AccountTier = "free";
		try {
			tier = ((await this.#identity.getUser(userId))?.metadata?.accountTier as AccountTier) ?? "free";
		} catch (e) {
			this.#logger.logWarn(`StorageQuota: error resolviendo el tier de ${userId}: ${(e as Error).message}`);
		}
		return { effectiveLimit: STORAGE_USER_TIER_LIMITS.free, scope: { kind: "personal", tier }, degraded: true };
	}

	async #orgTier(orgId: string): Promise<OrganizationTier> {
		try {
			const org = await this.#identity.getOrganization(orgId);
			if (!org) throw new StorageError(404, "ORG_NOT_FOUND", "Organización no encontrada");
			return (org.tier as OrganizationTier) ?? "default";
		} catch (e) {
			if (e instanceof StorageError) throw e;
			this.#logger.logWarn(`StorageQuota: error resolviendo la org ${orgId}: ${(e as Error).message}`);
			return "default";
		}
	}
}

/** Un override de plan visto como override de storage (la forma que espera la UI). */
function toStorageOverride(doc: PlanOverride): StorageLimitOverride {
	return {
		id: doc.id,
		subjectType: doc.subjectType,
		subjectId: doc.subjectId,
		orgId: doc.orgId,
		limitBytes: typeof doc.value === "number" ? doc.value : 0,
		createdBy: doc.createdBy,
		createdAt: doc.createdAt,
		updatedAt: doc.updatedAt,
	};
}

function numberOr(value: unknown, fallback: number): number {
	return typeof value === "number" ? value : fallback;
}
