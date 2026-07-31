import type { Model } from "mongoose";
import { usagePeriod, type MeterWindow, type PlanSubject, type UsageEntry } from "@common/types/plans/index.ts";
import { counterId, type UsageCounterDoc } from "../domain/index.ts";

/** Ventanas que se miden para cada feature de tipo `quota`. */
const WINDOWS: readonly MeterWindow[] = ["day", "month", "total"];

/**
 * Medición de consumo por (sujeto, feature, ventana, período).
 *
 * Generalización del `UsageManager` del image-editor: `$inc` con `upsert` en un
 * único `updateOne` (atómico) y **reset implícito** al rotar el período, sin cron.
 *
 * Se mide en las tres ventanas a la vez porque el mismo consumo puede estar
 * limitado por día y por mes simultáneamente (ej. exports del editor).
 */
export class UsageManager {
	readonly #model: Model<UsageCounterDoc>;

	constructor(model: Model<UsageCounterDoc>) {
		this.#model = model;
	}

	/** Consumo actual de una feature en todas sus ventanas. */
	async snapshot(subject: PlanSubject, featureKey: string, now: Date = new Date()): Promise<UsageEntry> {
		const orgId = subject.orgId ?? null;
		const ids = WINDOWS.map((w) => counterId(subject.userId, orgId, featureKey, w, usagePeriod(w, now)));
		const docs = await this.#model.find({ _id: { $in: ids } }).lean<UsageCounterDoc[]>();
		const byId = new Map(docs.map((d) => [d._id, d.count]));

		const entry: UsageEntry = {};
		WINDOWS.forEach((w, i) => {
			entry[w] = byId.get(ids[i]) ?? 0;
		});
		return entry;
	}

	/** Consumo de varias features en una sola consulta (alimenta `/api/plans/me`). */
	async snapshotMany(subject: PlanSubject, featureKeys: readonly string[], now: Date = new Date()): Promise<Record<string, UsageEntry>> {
		if (!featureKeys.length) return {};
		const orgId = subject.orgId ?? null;
		const idToTarget = new Map<string, { key: string; window: MeterWindow }>();
		for (const key of featureKeys) {
			for (const w of WINDOWS) {
				idToTarget.set(counterId(subject.userId, orgId, key, w, usagePeriod(w, now)), { key, window: w });
			}
		}
		const docs = await this.#model.find({ _id: { $in: [...idToTarget.keys()] } }).lean<UsageCounterDoc[]>();

		const result: Record<string, UsageEntry> = {};
		for (const key of featureKeys) result[key] = { day: 0, month: 0, total: 0 };
		for (const d of docs) {
			const target = idToTarget.get(d._id);
			if (target) result[target.key][target.window] = d.count;
		}
		return result;
	}

	/**
	 * Suma consumo en las tres ventanas. Devuelve el nuevo total de la ventana
	 * `enforced` (la del límite de la feature), leído del mismo write: es lo que
	 * permite a `commit()` detectar el exceso **después** de sumar, sin una lectura
	 * previa que abriría una ventana entre mirar y escribir.
	 */
	async increment(
		subject: PlanSubject,
		featureKey: string,
		amount = 1,
		enforced: MeterWindow = "month",
		now: Date = new Date()
	): Promise<number> {
		const orgId = subject.orgId ?? null;
		const results = await Promise.all(
			WINDOWS.map((w) =>
				this.#model
					.findOneAndUpdate(
						{ _id: counterId(subject.userId, orgId, featureKey, w, usagePeriod(w, now)) },
						{ $inc: { count: amount }, $set: { updatedAt: now } },
						{ upsert: true, new: true }
					)
					.lean<UsageCounterDoc>()
			)
		);
		return results[WINDOWS.indexOf(enforced)]?.count ?? amount;
	}

	/** Devuelve consumo (rollback de una operación fallida). Nunca baja de 0. */
	async decrement(subject: PlanSubject, featureKey: string, amount = 1, now: Date = new Date()): Promise<void> {
		const orgId = subject.orgId ?? null;
		await Promise.all(
			WINDOWS.map((w) =>
				this.#model.updateOne(
					{ _id: counterId(subject.userId, orgId, featureKey, w, usagePeriod(w, now)), count: { $gte: amount } },
					{ $inc: { count: -amount }, $set: { updatedAt: now } }
				)
			)
		);
	}
}
