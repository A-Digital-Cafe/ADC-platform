import mongoose, { type Model } from "mongoose";
import type { ILogger } from "../../../../interfaces/utils/ILogger.js";
import type MongoProvider from "../../../../providers/object/mongo/index.js";

/**
 * Representa una fila de la colección `modlogs` de pengubot (DB pyeDB).
 * Se mantiene desacoplado del schema original — solo leemos los campos que nos interesan.
 */
export interface PengubotModLogRow {
	_id: string;
	id: string; // discord userId
	moderator: string;
	reason: string;
	date: Date;
	type: string;
	hiddenCase?: boolean;
	reasonUnpenalized?: string;
	duration?: number;
}

interface IModlogSource {
	listActiveBans(): Promise<PengubotModLogRow[]>;
	listRevokedBans(since?: Date): Promise<PengubotModLogRow[]>;
	close(): Promise<void>;
}

/**
 * Adapter contra el Mongo de pengubot. Lee la colección `modlogs` directamente
 * usando un MongoProvider aliased (`pengubot@object/mongo`) gestionado por kernel.
 */
export class PengubotModlogsAdapter implements IModlogSource {
	#model: Model<PengubotModLogRow> | null = null;

	constructor(
		private readonly mongoProvider: MongoProvider,
		private readonly logger: ILogger
	) {}

	get enabled(): boolean {
		return this.mongoProvider.isConnected();
	}

	async #ensureConnected(): Promise<void> {
		if (this.#model) return;

		const startedAt = Date.now();
		while (!this.mongoProvider.isConnected() && Date.now() - startedAt < 8000) {
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
		if (!this.mongoProvider.isConnected()) throw new Error("Mongo de pengubot no conectado");

		const schema = new mongoose.Schema(
			{
				id: { type: String, required: true, index: true },
				moderator: String,
				reason: String,
				date: Date,
				type: String,
				hiddenCase: Boolean,
				reasonUnpenalized: String,
				duration: Number,
			},
			{ collection: "modlogs", strict: false }
		);

		this.#model = this.mongoProvider.createModel<PengubotModLogRow>("PengubotModLogs", schema);
		this.logger.logInfo("[PengubotModlogsAdapter] Conectado a Mongo de pengubot");
	}

	async listActiveBans(): Promise<PengubotModLogRow[]> {
		if (!this.enabled) return [];
		await this.#ensureConnected();
		const docs = await this.#model!.find({ type: "Ban", $or: [{ hiddenCase: false }, { hiddenCase: { $exists: false } }] })
			.lean();
		return docs as unknown as PengubotModLogRow[];
	}

	async listRevokedBans(since?: Date): Promise<PengubotModLogRow[]> {
		if (!this.enabled) return [];
		await this.#ensureConnected();
		const filter: Record<string, unknown> = { type: "Ban", hiddenCase: true };
		if (since) filter.date = { $gte: since };
		const docs = await this.#model!.find(filter).lean();
		return docs as unknown as PengubotModLogRow[];
	}

	async close(): Promise<void> {
		this.#model = null;
	}
}
