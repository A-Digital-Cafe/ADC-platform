import type { Model } from "mongoose";
import type { ILogger } from "@interfaces/utils/ILogger.js";
import { planKey, type PlanAxis, type PlanDefinition } from "@common/types/plans/index.ts";
import { PlanError } from "@common/types/custom-errors/PlanError.ts";
import { seedPlans, type ImportPlanItem, type PlanDefinitionDoc, type UpdatePlanPatch } from "../domain/index.ts";
import type { PlanCatalog } from "./PlanCatalog.ts";
import type { PlanSeeder } from "./PlanSeeder.ts";
import { mergeFeatures, mergeOptionalFeatures } from "./shared.ts";

/**
 * Escrituras **administrativas** sobre el catálogo: la edición desde el panel, la
 * publicación de la oferta comercial y la vuelta a los defaults del código.
 *
 * Todas marcan el plan como editado (`seeded: false`) salvo `resetPlan`, que es
 * justamente la que lo devuelve al dominio del seed.
 */
export class PlanWriter {
	readonly #model: Model<PlanDefinitionDoc>;
	readonly #catalog: PlanCatalog;
	readonly #seeder: PlanSeeder;
	readonly #logger: ILogger;

	constructor(model: Model<PlanDefinitionDoc>, catalog: PlanCatalog, seeder: PlanSeeder, logger: ILogger) {
		this.#model = model;
		this.#catalog = catalog;
		this.#seeder = seeder;
		this.#logger = logger;
	}

	/**
	 * Edición administrativa de un plan. Marca `seeded: false` para que los
	 * próximos arranques no lo pisen.
	 */
	async updatePlan(axis: PlanAxis, tier: string, patch: UpdatePlanPatch): Promise<PlanDefinition> {
		const _id = planKey(axis, tier);
		const current = await this.#model.findOne({ _id }).lean<PlanDefinitionDoc | null>();
		if (!current) throw new PlanError(404, "PLAN_NOT_FOUND", `Plan ${_id} no encontrado`);

		const features = patch.features ? { ...current.features, ...patch.features } : current.features;
		const memberFeatures = patch.memberFeatures ? { ...current.memberFeatures, ...patch.memberFeatures } : current.memberFeatures;
		const includedSeats = patch.includedSeats ?? current.includedSeats;
		// `price: null` es "sacar de venta" y `undefined` es "no lo toques": son casos
		// distintos, así que el borrado va por `$unset` y no por un `$set` a undefined.
		const clearPrice = patch.price === null;
		const price = clearPrice ? undefined : (patch.price ?? current.price);

		await this.#model.updateOne({ _id }, {
			$set: { features, memberFeatures, includedSeats, ...(clearPrice ? {} : { price }), updatedAt: new Date(), seeded: false },
			...(clearPrice ? { $unset: { price: "" } } : {}),
		});
		this.#catalog.invalidate();
		// El plan completo, no sólo lo editado: el panel pinta la fila con lo que devuelve.
		return {
			axis,
			tier,
			price,
			includedSeats,
			minSeats: current.minSeats,
			maxSeats: current.maxSeats,
			features,
			memberFeatures,
			expansionFeatures: current.expansionFeatures,
		};
	}

	/**
	 * Importa la oferta comercial, tal como la publica la herramienta externa de
	 * administración de precios. Merge por clave sobre cada plan y `seeded: false`:
	 * un plan importado queda congelado frente al seed y a los defaults de módulos.
	 *
	 * Valida la existencia de TODOS los planes antes de escribir el primero, para
	 * que un tier con typo no deje la oferta publicada a medias.
	 */
	async importPlans(items: readonly ImportPlanItem[]): Promise<string[]> {
		const docs = new Map<string, PlanDefinitionDoc>();
		for (const item of items) {
			const _id = planKey(item.axis, item.tier);
			const existing = await this.#model.findOne({ _id }).lean<PlanDefinitionDoc | null>();
			if (!existing) throw new PlanError(404, "PLAN_NOT_FOUND", `Plan ${_id} no encontrado`);
			docs.set(_id, existing);
		}

		const updated: string[] = [];
		for (const item of items) {
			const _id = planKey(item.axis, item.tier);
			const current = docs.get(_id)!;
			await this.#model.updateOne(
				{ _id },
				{
					$set: {
						features: mergeFeatures(current.features, item.features, true),
						memberFeatures: mergeOptionalFeatures(current.memberFeatures, item.memberFeatures, true),
						expansionFeatures: mergeOptionalFeatures(current.expansionFeatures, item.expansionFeatures, true),
						price: item.price ?? current.price,
						includedSeats: item.includedSeats ?? current.includedSeats,
						minSeats: item.minSeats ?? current.minSeats,
						maxSeats: item.maxSeats ?? current.maxSeats,
						updatedAt: new Date(),
						seeded: false,
					},
				}
			);
			updated.push(_id);
		}
		this.#catalog.invalidate();
		this.#logger.logOk(`PlanService: oferta importada sobre ${updated.length} planes`);
		return updated;
	}

	/**
	 * Descarta la personalización de un plan y lo devuelve a los defaults del código: el seed de
	 * plataforma más los defaults que los módulos registraron **en este proceso**.
	 *
	 * Es la contraparte de "el seed nunca pisa un plan editado", que si no dejaría congelado para
	 * siempre a cualquier plan tocado una vez. Ojo: también descarta la oferta importada, que hay
	 * que volver a publicar (`importPlans`).
	 */
	async resetPlan(axis: PlanAxis, tier: string): Promise<PlanDefinition> {
		const _id = planKey(axis, tier);
		const seeded = seedPlans().find((p) => p.axis === axis && p.tier === tier);
		if (!seeded) throw new PlanError(404, "PLAN_NOT_FOUND", `El plan ${_id} no existe en el código`);

		const composed = this.#seeder.composeDefaults(seeded);
		await this.#model.updateOne(
			{ _id },
			{
				$set: {
					includedSeats: composed.includedSeats,
					minSeats: composed.minSeats,
					maxSeats: composed.maxSeats,
					features: composed.features,
					memberFeatures: composed.memberFeatures,
					expansionFeatures: composed.expansionFeatures,
					updatedAt: new Date(),
					seeded: true,
				},
				// El código no tiene precios: volver a los defaults deja el plan fuera de
				// venta hasta que se vuelva a publicar la oferta.
				$unset: { price: "" },
			},
			{ upsert: true }
		);
		this.#catalog.invalidate();
		return composed;
	}
}
