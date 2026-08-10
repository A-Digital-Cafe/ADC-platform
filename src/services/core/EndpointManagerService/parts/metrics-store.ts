/**
 * Archivo histórico de métricas por endpoint: una fila por (hora cerrada, endpoint) en Mongo.
 *
 * Redis guarda sólo la hora en curso; cuando esa hora cierra, su hash se vuelca acá y se borra.
 * De ahí sale la ventana **móvil** de 24 h: a las 00:05 se sigue viendo la tarde anterior, cosa
 * que un acumulador por día no puede dar. La poda es explícita —al archivar una hora se borra
 * la que se cayó del borde— para que la retención sea la que declara la config y no la de un
 * índice TTL creado en el primer arranque.
 */
import { Schema, type Model } from "mongoose";
import type { MetricAggregate } from "./metrics-aggregate.js";
import { emptyAggregate, HIST_SLOTS, mergeAggregate } from "./metrics-aggregate.js";

/** Fila archivada: los contadores de UN endpoint durante UNA hora cerrada. */
export interface HourlyMetricDoc {
	/** `"<YYYY-MM-DDTHH>|<METHOD> <url>"`: hace idempotente el upsert sin índice único aparte. */
	_id: string;
	hour: string;
	hourStart: Date;
	key: string;
	owner: string;
	count: number;
	sumMs: number;
	maxMs: number;
	sumBytes: number;
	bytesCount: number;
	errCount: number;
	hist: number[];
	errByStatus: Map<string, number>;
}

/**
 * Marca de que una hora fue medida, exista o no tráfico. Sin esto, una hora tranquila (kernel
 * arriba, cero requests) sería indistinguible de una hora caída, y la media de llamadas/hora
 * se calcularía sólo sobre las horas con tráfico: siempre de más.
 */
export interface MeasuredHourDoc {
	_id: string;
	hourStart: Date;
	keys: number;
}

const hourlySchema = new Schema<HourlyMetricDoc>(
	{
		_id: { type: String, required: true },
		hour: { type: String, required: true, index: true },
		hourStart: { type: Date, required: true, index: true },
		key: { type: String, required: true, index: true },
		owner: { type: String, default: "" },
		count: { type: Number, required: true, default: 0 },
		sumMs: { type: Number, required: true, default: 0 },
		maxMs: { type: Number, required: true, default: 0 },
		sumBytes: { type: Number, required: true, default: 0 },
		bytesCount: { type: Number, required: true, default: 0 },
		errCount: { type: Number, required: true, default: 0 },
		hist: { type: [Number], default: () => new Array<number>(HIST_SLOTS).fill(0) },
		errByStatus: { type: Map, of: Number, default: () => new Map<string, number>() },
	},
	{ id: false, versionKey: false }
);

const measuredHourSchema = new Schema<MeasuredHourDoc>(
	{
		_id: { type: String, required: true },
		hourStart: { type: Date, required: true, index: true },
		keys: { type: Number, required: true, default: 0 },
	},
	{ id: false, versionKey: false }
);

export const METRICS_SCHEMAS = { hourly: hourlySchema, measuredHour: measuredHourSchema };

/** Lo que la ventana devuelve por endpoint: el total sumado más su reparto hora a hora. */
interface WindowEntry {
	owner: string;
	agg: MetricAggregate;
	/** Llamadas por hora, alineado con `covered` de la ventana. */
	hourly: number[];
}

export interface WindowRead {
	/** Horas cerradas efectivamente medidas, ascendente. Es el eje de todos los `hourly`. */
	covered: string[];
	byKey: Map<string, WindowEntry>;
}

/** Los docs vuelven `lean`, así que los Map de Mongo llegan como objetos planos. */
type LeanHourly = Omit<HourlyMetricDoc, "errByStatus"> & { errByStatus?: Record<string, number> };

function toAggregate(doc: LeanHourly): MetricAggregate {
	const agg = emptyAggregate();
	agg.count = doc.count ?? 0;
	agg.sumMs = doc.sumMs ?? 0;
	agg.maxMs = doc.maxMs ?? 0;
	agg.sumBytes = doc.sumBytes ?? 0;
	agg.bytesCount = doc.bytesCount ?? 0;
	agg.errCount = doc.errCount ?? 0;
	for (let i = 0; i < agg.hist.length; i++) agg.hist[i] = doc.hist?.[i] ?? 0;
	agg.errByStatus = { ...(doc.errByStatus ?? {}) };
	return agg;
}

export class MetricsStore {
	readonly #hourly: Model<HourlyMetricDoc>;
	readonly #measured: Model<MeasuredHourDoc>;

	constructor(hourly: Model<HourlyMetricDoc>, measured: Model<MeasuredHourDoc>) {
		this.#hourly = hourly;
		this.#measured = measured;
	}

	/**
	 * Archiva una hora cerrada. Escribe valores ABSOLUTOS (no incrementos): si el volcado se
	 * reintenta porque Mongo estaba caído, repetirlo no duplica nada.
	 */
	async archiveHour(hour: string, hourStart: Date, rows: Map<string, MetricAggregate>, ownerOf: (key: string) => string): Promise<void> {
		if (rows.size > 0) {
			await this.#hourly.bulkWrite(
				[...rows].map(([key, agg]) => ({
					updateOne: {
						filter: { _id: `${hour}|${key}` },
						update: {
							$set: {
								hour,
								hourStart,
								key,
								owner: ownerOf(key),
								count: agg.count,
								sumMs: agg.sumMs,
								maxMs: agg.maxMs,
								sumBytes: agg.sumBytes,
								bytesCount: agg.bytesCount,
								errCount: agg.errCount,
								hist: agg.hist,
								errByStatus: new Map(Object.entries(agg.errByStatus)),
							},
						},
						upsert: true,
					},
				}))
			);
		}
		// La marca va SIEMPRE, incluso con `rows` vacío: es lo que distingue "hora tranquila" de
		// "hora sin medir" a la hora de promediar. Con `rows` vacío se inserta pero NO se pisa: el
		// barrido vuelve a pasar por horas ya archivadas (su hash ya no está) y borraría el conteo.
		const update = rows.size > 0 ? { $set: { hourStart, keys: rows.size } } : { $setOnInsert: { hourStart, keys: 0 } };
		await this.#measured.updateOne({ _id: hour }, update, { upsert: true });
	}

	/** Borra todo lo anterior a `cutoff`: la hora que se cayó del borde de la ventana. */
	async purgeBefore(cutoff: Date): Promise<number> {
		const [rows] = await Promise.all([
			this.#hourly.deleteMany({ hourStart: { $lt: cutoff } }),
			this.#measured.deleteMany({ hourStart: { $lt: cutoff } }),
		]);
		return rows.deletedCount ?? 0;
	}

	/** Lee las horas archivadas de la ventana y las suma por endpoint, guardando el reparto horario. */
	async readWindow(hours: string[]): Promise<WindowRead> {
		const [docs, measured] = await Promise.all([
			this.#hourly
				.find({ hour: { $in: hours } })
				.lean<LeanHourly[]>()
				.exec(),
			this.#measured
				.find({ _id: { $in: hours } })
				.lean<MeasuredHourDoc[]>()
				.exec(),
		]);
		// El eje conserva el orden cronológico de `hours`, no el que devuelva Mongo.
		const measuredSet = new Set(measured.map((m) => m._id));
		const covered = hours.filter((h) => measuredSet.has(h));
		const slotOfHour = new Map(covered.map((h, i) => [h, i]));

		const byKey = new Map<string, WindowEntry>();
		for (const doc of docs) {
			const slot = slotOfHour.get(doc.hour);
			// Fila de una hora sin marca de medición (archivado a medias): se suma igual al total,
			// pero no tiene ranura en el eje horario.
			let entry = byKey.get(doc.key);
			if (!entry) {
				entry = { owner: doc.owner ?? "", agg: emptyAggregate(), hourly: new Array<number>(covered.length).fill(0) };
				byKey.set(doc.key, entry);
			}
			if (doc.owner && !entry.owner) entry.owner = doc.owner;
			mergeAggregate(entry.agg, toAggregate(doc));
			if (slot !== undefined) entry.hourly[slot] += doc.count ?? 0;
		}
		return { covered, byKey };
	}

	/**
	 * Borra el histórico de una clave (o de todas). Devuelve las claves afectadas, no el conteo de
	 * documentos: un endpoint tiene una fila POR HORA, así que "24 filas" no es lo que el panel
	 * quiere informar. Las marcas de hora medida no se tocan: siguen describiendo qué se midió.
	 */
	async clear(key?: string): Promise<string[]> {
		const filter = key ? { key } : {};
		const keys = await this.#hourly.distinct<string>("key", filter).exec();
		await this.#hourly.deleteMany(filter);
		return keys;
	}
}
