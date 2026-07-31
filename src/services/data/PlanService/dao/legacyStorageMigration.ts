import type { Model } from "mongoose";
import type { ILogger } from "@interfaces/utils/ILogger.js";
import { STORAGE_TOTAL_FEATURE } from "@common/types/tiers/storage.ts";
import type { LegacyStorageOverrideDoc } from "../domain/index.ts";
import type { OverridesManager } from "./OverridesManager.ts";

/**
 * Copia los overrides de la vieja colección de storage al catálogo unificado.
 *
 * Corre en cada arranque pero sólo actúa sobre los documentos sin `migratedAt`, así
 * que borrar un override ya migrado no lo resucita. Nunca hace fallar el arranque:
 * un error acá deja los overrides viejos sin aplicar, no el servicio caído.
 *
 * Este archivo (y el schema legacy que consume) se pueden borrar una vez que el
 * despliegue esté consolidado.
 */
export async function migrateLegacyStorageOverrides(
	model: Model<LegacyStorageOverrideDoc>,
	overrides: OverridesManager,
	logger: ILogger
): Promise<void> {
	try {
		const pending = await model.find({ migratedAt: { $exists: false } }).lean<LegacyStorageOverrideDoc[]>();
		if (!pending.length) return;

		const imported = await overrides.importExisting(
			pending.map((d) => ({
				subjectType: d.subjectType,
				subjectId: d.subjectId,
				orgId: d.orgId ?? null,
				featureKey: STORAGE_TOTAL_FEATURE,
				value: d.limitBytes,
				createdBy: d.createdBy,
				createdAt: d.createdAt,
				updatedAt: d.updatedAt,
			}))
		);
		await model.updateMany({ id: { $in: pending.map((d) => d.id) } }, { $set: { migratedAt: new Date() } });
		logger.logOk(`PlanService: ${imported}/${pending.length} overrides de storage migrados a plan_overrides`);
	} catch (e) {
		logger.logWarn(`PlanService: no se pudieron migrar los overrides de storage: ${(e as Error).message}`);
	}
}
