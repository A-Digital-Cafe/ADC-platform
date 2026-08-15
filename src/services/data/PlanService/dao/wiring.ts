import type { Model } from "mongoose";
import type { ILogger } from "@interfaces/utils/ILogger.js";
import { PlanCatalog } from "./PlanCatalog.ts";
import { CapacityGuard, readCapacityConfig, type CountsSource } from "./CapacityGuard.ts";
import { PlanSeeder } from "./PlanSeeder.ts";
import { PlanWriter } from "./PlanWriter.ts";
import { TierResolver, type IdentitySource } from "./TierResolver.ts";
import { SeatCounter, type SeatIdentitySource } from "./SeatCounter.ts";
import { OverrideResolver } from "./OverrideResolver.ts";
import { OverridesManager } from "./OverridesManager.ts";
import { OrgPlanAdmin, type InvalidateCaches } from "./OrgPlanAdmin.ts";
import { OrgLevelResolver } from "./OrgLevelResolver.ts";
import { PlanResolver } from "./PlanResolver.ts";
import { UsageManager } from "./UsageManager.ts";
import { EntitlementsManager } from "./EntitlementsManager.ts";
import { migrateLegacyStorageOverrides } from "./legacyStorageMigration.ts";
import {
	legacyStorageOverrideSchema,
	planDefinitionSchema,
	planOverrideSchema,
	usageCounterSchema,
	type LegacyStorageOverrideDoc,
	type PlanDefinitionDoc,
	type PlanOverrideDoc,
	type UsageCounterDoc,
} from "../domain/index.ts";

/** Crea con un provider ya conectado los models del servicio (todos en un solo lugar). */
export function createPlanModels(provider: {
	createModel<T>(collection: string, schema: unknown): Model<T>;
}): PlanModels {
	return {
		plans: provider.createModel<PlanDefinitionDoc>("plan_definitions", planDefinitionSchema),
		overrides: provider.createModel<PlanOverrideDoc>("plan_overrides", planOverrideSchema),
		usage: provider.createModel<UsageCounterDoc>("usage_counters", usageCounterSchema),
		legacyStorage: provider.createModel<LegacyStorageOverrideDoc>("storage_limit_overrides", legacyStorageOverrideSchema),
	};
}

export interface PlanModels {
	plans: Model<PlanDefinitionDoc>;
	overrides: Model<PlanOverrideDoc>;
	usage: Model<UsageCounterDoc>;
	/** Colección vieja de storage; se migra una sola vez y después sobra. */
	legacyStorage: Model<LegacyStorageOverrideDoc>;
}

/** Managers del motor, ya cableados entre sí. */
export interface PlanManagers {
	catalog: PlanCatalog;
	seeder: PlanSeeder;
	writer: PlanWriter;
	tiers: TierResolver;
	seats: SeatCounter;
	overrides: OverridesManager;
	/** Lado de lectura de los overrides; se expone sólo para poder invalidar su cache. */
	overrideResolver: OverrideResolver;
	orgAdmin: OrgPlanAdmin;
	entitlements: EntitlementsManager;
	/** ¿Alcanza el disco para vender un plan más? */
	capacity: CapacityGuard;
}

/**
 * Composición de la capa DAO: quién depende de quién.
 *
 * Vive fuera del `index.ts` porque el grafo tiene una arista diferida (el manager de
 * overrides necesita el techo de la organización, que sólo sabe calcular el resolver
 * que a su vez depende de él) y esa sutileza merece leerse junta, no mezclada con el
 * arranque del servicio.
 */
export function buildPlanManagers(
	models: PlanModels,
	deps: {
		identity: IdentitySource;
		seatSource: SeatIdentitySource;
		counts: CountsSource;
		/** Bloque `private.capacity` del config, sin interpretar. */
		capacityConfig: Record<string, unknown> | undefined;
		logger: ILogger;
		invalidate: InvalidateCaches;
	}
): PlanManagers {
	const catalog = new PlanCatalog(models.plans);
	const seeder = new PlanSeeder(models.plans, catalog, deps.logger);
	const writer = new PlanWriter(models.plans, deps.invalidate, seeder, deps.logger);

	const tiers = new TierResolver(deps.identity);
	const seats = new SeatCounter(deps.seatSource, deps.logger);
	const overrideResolver = new OverrideResolver(models.overrides, deps.identity);
	// Toda escritura de override descarta las caches de resolución, venga del panel
	// de administración o de otro módulo por `PlanOverridesAdmin`.
	const overrides = new OverridesManager(models.overrides, deps.identity, () => deps.invalidate());

	const orgLevel = new OrgLevelResolver(catalog, overrideResolver);
	const resolver = new PlanResolver(catalog, tiers, seats, overrideResolver, orgLevel);
	const entitlements = new EntitlementsManager(catalog, resolver, new UsageManager(models.usage));

	// Diferido: el resolver depende de los overrides, no al revés.
	overrides.setOrgCeilingResolver(async (orgId, featureKey) => (await orgLevel.level(orgId, await tiers.orgTier(orgId))).values[featureKey]);

	return {
		capacity: new CapacityGuard(readCapacityConfig(deps.capacityConfig), catalog, deps.counts, deps.logger),
		catalog,
		seeder,
		writer,
		tiers,
		seats,
		overrides,
		overrideResolver,
		orgAdmin: new OrgPlanAdmin(overrides, deps.invalidate),
		entitlements,
	};
}

/** Arranque de datos: siembra el catálogo y migra los overrides viejos de storage. */
export async function bootstrapPlanData(managers: PlanManagers, models: PlanModels, logger: ILogger): Promise<void> {
	await managers.seeder.seed();
	await migrateLegacyStorageOverrides(models.legacyStorage, managers.overrides, logger);
}
