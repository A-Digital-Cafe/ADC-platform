import type MongoProvider from "@providers/object/mongo/index.js";
import { BaseService } from "@services/BaseService.js";
import { EnableEndpoints, DisableEndpoints } from "@services/core/EndpointManagerService/index.js";
import type { IIdentityManagerService } from "@common/types/identity/IIdentityManagerService.js";
import { Scope, assertScope, type Capability } from "@common/security/Capability.ts";
import type { EntitlementsProvider, FeatureDef, ModulePlanDefaults, OrgPlanSnapshot, PlanOverridesAdmin, PlanPrice } from "@common/types/plans/index.ts";
import type { IPlanService } from "@common/types/plans/IPlanService.ts";
import { PlanError } from "@common/types/custom-errors/PlanError.ts";
import type { IClusterService } from "@common/types/cluster/ICluster.ts";
import type { IPlatformSettingsService } from "@common/types/platform/IPlatformSettingsService.ts";
import type { CapacityPolicy } from "./dao/CapacityGuard.ts";
import { buildPlanManagers, bootstrapPlanData, createPlanModels, type PlanManagers } from "./dao/wiring.ts";
import type { EntitlementsManager } from "./dao/EntitlementsManager.ts";
import { entitlementsProviderOf, overridesAdminOf } from "./dao/adapters.ts";
import { PLAN_ENDPOINTS } from "./endpoints/index.ts";

/** Topic del bus con el que un nodo avisa que las caches de planes dejaron de valer. */
const CLUSTER_TOPIC_PLANS_INVALIDATE = "plans.invalidate";

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
	#unsubscribeCluster: (() => void) | null = null;
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
			// Cuántas cuentas hay por tier: es lo comprometido, y con eso el control de
			// capacidad decide si todavía se puede vender un plan más.
			counts: {
				countUsersByTier: () => internal.users.countUsersByTier(),
				countOrgsByTier: () => internal.organizations.countOrganizationsByTier(),
			},
			capacityConfig: (this.config?.private as Record<string, unknown> | undefined)?.capacity as Record<string, unknown> | undefined,
			logger: this.logger,
			invalidate: (orgId) => this.invalidate(orgId),
		});
		await bootstrapPlanData(this.#managers, models, this.logger);
		this.#subscribeCluster();

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
	 * ¿Queda disco para vender este plan? Lo consulta el catálogo público (para no
	 * ofrecer lo que no se puede sostener) y el checkout (para no cobrarlo).
	 *
	 * Sin medición disponible devuelve `available: true`: un control de capacidad
	 * que no puede medir no debe cortar la facturación.
	 */
	canOfferPlan(key: string, seats = 1): Promise<{ available: boolean; reason?: string }> {
		const [axis, tier] = key.split(":");
		if (axis !== "user" && axis !== "org") return Promise.resolve({ available: true });
		return this.daos.capacity.canOffer(axis, tier, seats);
	}

	/** Estado de capacidad del nodo, con la política vigente (panel y diagnóstico). */
	async capacityReport() {
		return { ...(await this.daos.capacity.report()), policy: this.daos.capacity.policy };
	}

	/**
	 * Cambia la política de capacidad: cuánto del disco se reserva, cuánto se
	 * sobrevende y con cuánto libre se deja de vender.
	 *
	 * Es **del clúster**: se persiste en `platform_settings` y se aplica en caliente
	 * acá; los otros nodos la toman al reiniciar. La capacidad en sí no se toca desde
	 * acá — cada nodo tiene su disco, medido o declarado en su `env/`.
	 */
	async setCapacityPolicy(policy: Partial<CapacityPolicy>, actor: string | undefined): Promise<CapacityPolicy> {
		const applied = this.daos.capacity.setPolicy(policy);
		const settings = this.tryGetMyService<IPlatformSettingsService>("PlatformSettingsService");
		if (settings) {
			await settings.setSetting("ADC_STORAGE_HEADROOM_PCT", String(applied.headroomPct), actor);
			await settings.setSetting("ADC_STORAGE_OVERSUBSCRIPTION", String(applied.oversubscription), actor);
			await settings.setSetting("ADC_STORAGE_MIN_FREE_PCT", String(applied.minFreePct), actor);
		} else {
			this.logger.logWarn("[plans] política de capacidad aplicada sólo en memoria: sin PlatformSettingsService no sobrevive al reinicio");
		}
		this.logger.logWarn(
			`[plans] política de capacidad: margen ${applied.headroomPct}%, sobreventa x${applied.oversubscription}, ` +
				`mínimo libre ${applied.minFreePct}% — cambiada por '${actor ?? "desconocido"}'`
		);
		return applied;
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

	/**
	 * Descarta las caches de resolución (tras editar planes, overrides o membresías) **en todos los
	 * nodos**.
	 *
	 * Cada nodo cachea por su cuenta, así que sin el aviso el que no atendió la escritura sigue
	 * cobrando el precio viejo, aplicando el límite de `free` a quien acaba de pagar o rechazando
	 * por una cuota que ya se amplió, hasta que venza su TTL (30-60 s). El bus es best-effort:
	 * acelera la convergencia, el TTL sigue siendo la red de contención.
	 */
	invalidate(orgId?: string): void {
		this.#invalidateLocal(orgId);
		void this.#cluster()?.publish(CLUSTER_TOPIC_PLANS_INVALIDATE, { orgId });
	}

	/** Sólo el efecto local: es lo que aplica el handler del bus, que no debe volver a publicar. */
	#invalidateLocal(orgId?: string): void {
		this.#managers?.catalog.invalidate();
		this.#managers?.tiers.invalidate();
		this.#managers?.overrideResolver.invalidate();
		this.#managers?.seats.invalidate(orgId);
	}

	#subscribeCluster(): void {
		const cluster = this.#cluster();
		if (!cluster) return;
		this.#unsubscribeCluster?.();
		this.#unsubscribeCluster = cluster.subscribe<{ orgId?: string }>(CLUSTER_TOPIC_PLANS_INVALIDATE, (msg) => {
			this.#invalidateLocal(msg.payload?.orgId);
		});
	}

	/** Opcional a propósito: sin clúster cada nodo invalida lo suyo y converge por TTL. */
	#cluster(): IClusterService | undefined {
		return this.tryGetMyService<IClusterService>("ClusterService");
	}

	@DisableEndpoints()
	async stop(kernelKey: symbol): Promise<void> {
		await super.stop(kernelKey);
		// Sin esto el handler sobrevive a la recarga del módulo y le invalida caches a managers
		// que ya nadie consulta.
		this.#unsubscribeCluster?.();
		this.#unsubscribeCluster = null;
		this.logger.logOk("PlanService detenido");
	}
}
