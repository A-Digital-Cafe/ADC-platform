import type { Model } from "mongoose";
import type { ILogger } from "@interfaces/utils/ILogger.js";
import { planKey, type ModulePlanDefaults, type PlanDefinition } from "@common/types/plans/index.ts";
import { seedPlans, type PlanDefinitionDoc } from "../domain/index.ts";
import type { PlanCatalog } from "./PlanCatalog.ts";
import { mergeFeatures, mergeOptionalFeatures, pendingPlansFrom } from "./shared.ts";

/**
 * Escrituras que vienen **del código**: el seed de plataforma y los defaults que
 * cada módulo aporta al registrarse.
 *
 * Regla común a estas escrituras: nada pisa un plan editado o importado
 * (`seeded: false`); sobre esos sólo se agregan claves nuevas.
 *
 * Invalidan la cache local y nada más, a diferencia de `PlanWriter`: cada nodo las corre en su
 * propio arranque con el mismo código y lo que escriben sólo agrega claves, así que avisarle al
 * clúster sería ruido en cada boot para algo que converge solo por TTL.
 */
export class PlanSeeder {
	readonly #model: Model<PlanDefinitionDoc>;
	readonly #catalog: PlanCatalog;
	readonly #logger: ILogger;
	/** Defaults aportados por módulos en este proceso; insumo de `composeDefaults`. */
	readonly #moduleDefaults: ModulePlanDefaults[] = [];

	constructor(model: Model<PlanDefinitionDoc>, catalog: PlanCatalog, logger: ILogger) {
		this.#model = model;
		this.#catalog = catalog;
		this.#logger = logger;
	}

	/**
	 * Siembra los planes que faltan y refresca los que nadie editó. Idempotente: corre en cada
	 * arranque.
	 *
	 * El seed sólo aporta las claves de **plataforma**; las de cada módulo llegan después vía
	 * `applyModuleDefaults`. Por eso el refresco es siempre un merge por clave: un reemplazo del
	 * objeto de features borraría lo que los módulos registraron en arranques anteriores.
	 */
	async seed(): Promise<void> {
		for (const plan of seedPlans()) {
			const _id = planKey(plan.axis, plan.tier);
			// El `upsert` va con filtro sólo por `_id`: uno con filtro adicional intenta
			// INSERTAR cuando el doc existe pero no matchea, y revienta con duplicate key.
			await this.#model.updateOne({ _id }, { $setOnInsert: { ...plan, updatedAt: new Date(), seeded: true } }, { upsert: true });

			const existing = await this.#model.findOne({ _id }).lean<PlanDefinitionDoc | null>();
			if (!existing) continue;

			const authoritative = existing.seeded !== false;
			// Se reescribe el objeto entero: las claves de feature llevan puntos
			// (`drive.maxFileSize`) y un `$set` con path punteado sería ambiguo en Mongo.
			const $set: Record<string, unknown> = {
				features: mergeFeatures(existing.features, plan.features, authoritative),
				memberFeatures: mergeOptionalFeatures(existing.memberFeatures, plan.memberFeatures, authoritative),
				expansionFeatures: mergeOptionalFeatures(existing.expansionFeatures, plan.expansionFeatures, authoritative),
				updatedAt: new Date(),
			};
			if (authoritative) {
				$set.includedSeats = plan.includedSeats;
				$set.minSeats = plan.minSeats;
				$set.maxSeats = plan.maxSeats;
				// `access` describe la naturaleza del plan (gratuito, otorgado, a cotizar),
				// no su precio: se refresca con el resto del seed para que un despliegue ya
				// instalado incorpore el dato sin tener que republicar la oferta.
				$set.access = plan.access;
			}
			await this.#model.updateOne({ _id }, { $set });
		}
		this.#catalog.invalidate();
		this.#logger.logDebug("PlanService: catálogo de planes sembrado");
	}

	/**
	 * Mergea los defaults de un módulo sobre los planes existentes. Idempotente: cada módulo la
	 * ejecuta en cada arranque al registrarse. Un tier inexistente se ignora: los shells por tier
	 * los crea el seed de plataforma, que corre antes (kernelMode 62).
	 */
	async applyModuleDefaults(defaults: ModulePlanDefaults): Promise<void> {
		this.#moduleDefaults.push(defaults);

		for (const [_id, pending] of pendingPlansFrom(defaults)) {
			const existing = await this.#model.findOne({ _id }).lean<PlanDefinitionDoc | null>();
			if (!existing) {
				this.#logger.logWarn(`PlanService: defaults de módulo para el plan inexistente ${_id}, ignorados`);
				continue;
			}
			const authoritative = existing.seeded !== false;
			await this.#model.updateOne(
				{ _id },
				{
					$set: {
						features: mergeFeatures(existing.features, pending.features, authoritative),
						memberFeatures: mergeOptionalFeatures(existing.memberFeatures, pending.memberFeatures, authoritative),
						expansionFeatures: mergeOptionalFeatures(existing.expansionFeatures, pending.expansionFeatures, authoritative),
						updatedAt: new Date(),
					},
				}
			);
		}
		this.#catalog.invalidate();
	}

	/** El plan tal como lo define el código: seed de plataforma + defaults de los módulos registrados en este proceso. */
	composeDefaults(seeded: PlanDefinition): PlanDefinition {
		const composed: PlanDefinition = structuredClone(seeded);
		for (const d of this.#moduleDefaults) {
			const features = (seeded.axis === "user" ? d.user : d.org)?.[seeded.tier];
			if (features) composed.features = { ...composed.features, ...features };
			if (seeded.axis !== "org") continue;
			const member = d.orgMember?.[seeded.tier];
			if (member) composed.memberFeatures = { ...composed.memberFeatures, ...member };
			const expansion = d.expansion?.[seeded.tier];
			if (expansion) composed.expansionFeatures = { ...composed.expansionFeatures, ...expansion };
		}
		return composed;
	}
}
