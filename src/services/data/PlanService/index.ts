import type MongoProvider from "@providers/object/mongo/index.js";
import { BaseService } from "@services/BaseService.js";
import { EnableEndpoints, DisableEndpoints } from "@services/core/EndpointManagerService/index.js";
import type { IIdentityManagerService } from "@common/types/identity/IIdentityManagerService.js";
import { Scope, assertScope, type Capability } from "@common/security/Capability.ts";
import type { EntitlementsProvider, FeatureDef, ModulePlanDefaults, OrgPlanSnapshot, PlanOverridesAdmin, PlanPrice } from "@common/types/plans/index.ts";
import type { IPlanService } from "@common/types/plans/IPlanService.ts";
import { PlanError } from "@common/types/custom-errors/PlanError.ts";
import { buildPlanManagers, bootstrapPlanData, createPlanModels, type PlanManagers } from "./dao/wiring.ts";
import type { EntitlementsManager } from "./dao/EntitlementsManager.ts";
import { entitlementsProviderOf, overridesAdminOf } from "./dao/adapters.ts";
import { PLAN_ENDPOINTS } from "./endpoints/index.ts";

/**
 * Motor central de planes y límites.
 *
 * Los módulos declaran sus features con `registerFeatures()` y consultan límites y
 * consumo por `entitlements`. Si este servicio no está cargado, cada módulo degrada
 * a su matriz local: **fail-open**, igual que `AttachmentsManager` con las cuotas.
 */
export default class PlanService extends BaseService implements IPlanService {
	public readonly name = "PlanService";

	#managers: PlanManagers | null = null;
	private mongoProvider!: MongoProvider;

	@EnableEndpoints({ managers: () => PLAN_ENDPOINTS })
	async start(kernelKey: symbol): Promise<void> {
		await super.start(kernelKey);

		this.mongoProvider = this.getMyProvider<MongoProvider>("object/mongo");
		await this.waitForProvider(this.mongoProvider, "MongoDB");

		const identity = this.getMyService<IIdentityManagerService>("IdentityManagerService");
		const internal = identity._internal(this.getCapability());
		const models = createPlanModels(this.mongoProvider);

		this.#managers = buildPlanManagers(models, {
			identity: {
				getUser: (userId) => internal.users.getUser(userId),
				getOrganization: (orgIdOrSlug) => internal.organizations.getOrganization(orgIdOrSlug),
				getRole: (roleId) => internal.roles.getRole(roleId),
			},
			seatSource: { getAllUsers: (token, orgId, opts) => internal.users.getAllUsers(token, orgId, opts) },
			logger: this.logger,
			invalidate: (orgId) => this.invalidate(orgId),
		});
		await bootstrapPlanData(this.#managers, models, this.logger);

		for (const endpoints of PLAN_ENDPOINTS) endpoints.init(this, kernelKey);
		this.logger.logOk("PlanService iniciado");
	}

	/** Superficie estable que consumen los módulos. */
	get entitlements(): EntitlementsProvider {
		return entitlementsProviderOf(this.manager);
	}

	/** Administración de excepciones por interfaz, para módulos con panel de límites propio. */
	get overridesAdmin(): PlanOverridesAdmin {
		return overridesAdminOf(this.daos.overrides);
	}

	/**
	 * Managers del motor, para los endpoints del servicio. Getter defensivo: sin
	 * managers el servicio está indisponible, no roto el caller.
	 */
	get daos(): PlanManagers {
		if (!this.#managers) throw new PlanError(503, "PLANS_UNAVAILABLE", "PlanService no inicializado");
		return this.#managers;
	}

	/** Atajo al manager de entitlements, que es el que consume casi todo. */
	get manager(): EntitlementsManager {
		return this.daos.entitlements;
	}

	orgSnapshot(orgId: string): Promise<OrgPlanSnapshot> {
		return this.manager.orgSnapshot(orgId);
	}

	seats(orgId: string): Promise<{ paidSeats: number; activeSeats: number }> {
		return this.manager.seats(orgId);
	}

	/** Rango de asientos contratable de un tier de organización. */
	seatBounds(tier: string): Promise<{ minSeats: number; maxSeats: number | null } | null> {
		return this.daos.catalog.seatBounds(tier);
	}

	/** Precio de lista de un plan; `null` si no existe o no está a la venta. */
	planPrice(key: string): Promise<PlanPrice | null> {
		return this.daos.catalog.planPrice(key);
	}

	/**
	 * Declara las features vendibles de un módulo y mergea sus defaults de plan.
	 * Scope `plans:register`. Idempotente: cada módulo la llama en cada arranque.
	 */
	async registerFeatures(token: Capability, features: readonly FeatureDef[], defaults?: ModulePlanDefaults): Promise<void> {
		assertScope(token, Scope.PlanRegister);
		this.daos.catalog.registerFeatures(features);
		if (defaults) await this.daos.seeder.applyModuleDefaults(defaults);
	}

	/** Otorga o revoca la ampliación de una organización. Scope `plans:admin`. */
	async setOrgExpansion(token: Capability, orgId: string, granted: boolean, actorUserId: string): Promise<void> {
		assertScope(token, Scope.PlanAdmin);
		await this.daos.orgAdmin.setExpansion(orgId, granted, actorUserId);
	}

	/** Fija los asientos pagos de una organización. Scope `plans:admin`. */
	async setOrgSeats(token: Capability, orgId: string, seats: number, actorUserId: string): Promise<void> {
		assertScope(token, Scope.PlanAdmin);
		await this.daos.orgAdmin.setSeats(orgId, seats, actorUserId);
	}

	/** Descarta las caches de resolución (tras editar planes, overrides o membresías). */
	invalidate(orgId?: string): void {
		this.#managers?.catalog.invalidate();
		this.#managers?.tiers.invalidate();
		this.#managers?.overrideResolver.invalidate();
		this.#managers?.seats.invalidate(orgId);
	}

	@DisableEndpoints()
	async stop(kernelKey: symbol): Promise<void> {
		await super.stop(kernelKey);
		this.logger.logOk("PlanService detenido");
	}
}
