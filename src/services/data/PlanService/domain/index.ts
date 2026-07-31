/** Entidades persistidas del motor de planes. Los models se crean en `PlanService.start()`. */

export { planDefinitionSchema, type ImportPlanItem, type PlanDefinitionDoc, type UpdatePlanPatch } from "./planDefinition.ts";
export { planOverrideSchema, type PlanOverrideDoc, type PlanSubjectType } from "./planOverride.ts";
export { counterId, usageCounterSchema, type UsageCounterDoc } from "./usageCounter.ts";
export { legacyStorageOverrideSchema, type LegacyStorageOverrideDoc } from "./legacyStorageOverrides.ts";
export { EXPANSION_FEATURE, SEATS_FEATURE } from "./features.ts";
export { SEED_FEATURES, seedPlans } from "./seeds.ts";
