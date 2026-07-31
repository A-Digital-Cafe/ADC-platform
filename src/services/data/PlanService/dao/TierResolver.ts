import type { AccountTier } from "@common/types/tiers.ts";
import type { OrganizationTier } from "@common/types/identity/Organization.ts";
import type { PlanAxis, PlanSubject } from "@common/types/plans/index.ts";
import { SystemRole } from "@services/core/IdentityManagerService/defaults/systemRoles.js";
import LRUCache from "@adc/utils/performance/LRUCache.ts";

/**
 * Fuente mínima de identity (managers internos, sin auth). Espejo de la de
 * `StorageQuotaService.LimitsManager`.
 */
export interface IdentitySource {
	getUser(userId: string): Promise<{
		roleIds?: string[];
		metadata?: { accountTier?: string } | null;
		orgMemberships?: Array<{ orgId: string; roleIds: string[] }>;
	} | null>;
	getOrganization(orgIdOrSlug: string): Promise<{ orgId?: string; tier?: string } | null>;
	getRole(roleId: string): Promise<{ name?: string; orgId?: string | null } | null>;
}

const CACHE_TTL_MS = 30_000;

interface Cached<T> {
	value: T;
	expiresAt: number;
}

/**
 * **El único** resolver de tier de la plataforma.
 *
 * - Usuario → `user.metadata.accountTier`, default `free`. El tier no viaja en el token.
 * - Organización → `org.tier`, default `default`.
 * - **Un admin global** (rol `SystemRole.ADMIN` sin `orgId`) recibe el tier máximo:
 *   evita que quien administra la plataforma choque con sus propios límites.
 * - Tolerante a fallos: ante cualquier error devuelve el tier base.
 */
export class TierResolver {
	readonly #identity: IdentitySource;
	readonly #userCache = new LRUCache<string, Cached<AccountTier>>(2000);
	readonly #orgCache = new LRUCache<string, Cached<OrganizationTier>>(500);

	constructor(identity: IdentitySource) {
		this.#identity = identity;
	}

	async userTier(userId: string): Promise<AccountTier> {
		if (!userId) return "free";
		const cached = this.#userCache.get(userId);
		if (cached && cached.expiresAt > Date.now()) return cached.value;

		let tier: AccountTier;
		try {
			const user = await this.#identity.getUser(userId);
			tier = (user?.metadata?.accountTier as AccountTier) ?? "free";
			if (tier !== "plus" && (await this.#isGlobalAdmin(user?.roleIds))) tier = "plus";
		} catch {
			tier = "free";
		}
		this.#userCache.set(userId, { value: tier, expiresAt: Date.now() + CACHE_TTL_MS });
		return tier;
	}

	async orgTier(orgId: string): Promise<OrganizationTier> {
		if (!orgId) return "default";
		const cached = this.#orgCache.get(orgId);
		if (cached && cached.expiresAt > Date.now()) return cached.value;

		let tier: OrganizationTier;
		try {
			const org = await this.#identity.getOrganization(orgId);
			tier = (org?.tier as OrganizationTier) ?? "default";
		} catch {
			tier = "default";
		}
		this.#orgCache.set(orgId, { value: tier, expiresAt: Date.now() + CACHE_TTL_MS });
		return tier;
	}

	/** Eje y tier del sujeto: `orgId` presente ⇒ eje organización. */
	async resolve(subject: PlanSubject): Promise<{ axis: PlanAxis; tier: string }> {
		const orgId = subject.orgId ?? null;
		if (orgId) return { axis: "org", tier: await this.orgTier(orgId) };
		return { axis: "user", tier: await this.userTier(subject.userId) };
	}

	invalidate(): void {
		this.#userCache.clear();
		this.#orgCache.clear();
	}

	async #isGlobalAdmin(roleIds?: string[]): Promise<boolean> {
		if (!roleIds?.length) return false;
		for (const roleId of roleIds) {
			const role = await this.#identity.getRole(roleId).catch(() => null);
			if (role?.name === SystemRole.ADMIN && !role.orgId) return true;
		}
		return false;
	}
}
