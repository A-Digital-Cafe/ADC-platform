import type { Model } from "mongoose";
import type { ILogger } from "@interfaces/utils/ILogger.js";
import {
	UNLIMITED_BYTES,
	type QuotaCheckResult,
	type QuotaSubject,
	type StorageAppUsage,
	type StorageAppInfo,
	type StorageUsageSnapshot,
} from "@common/types/storage/quota.ts";
import { getStorageAppMinBytes, type QuotaScope } from "@common/types/tiers/storage.ts";
import { usageDocId, type StorageUsageDoc } from "../domain/usage.ts";
import type { LimitsManager } from "./LimitsManager.ts";

/** Registro de una app consumidora de attachments (el mínimo sale de la matriz central de tiers). */
export interface RegisteredApp {
	appId: string;
	label: string;
	/** Recalcula el uso real por (usuario, contexto) (para reconciliación). */
	computeUsage?: () => Promise<Array<{ userId: string; orgId: string | null; bytes: number; count: number }>>;
}

/**
 * Contadores de uso por (usuario, contexto) con enforcement atómico.
 *
 * `commit` usa un único `updateOne` condicional: el incremento solo matchea si
 * el uso de la app queda dentro de su mínimo garantizado O el total dentro del
 * límite efectivo del contexto. Sin ventana check-then-increment.
 */
export class QuotaManager {
	readonly #model: Model<StorageUsageDoc>;
	readonly #limits: LimitsManager;
	readonly #logger: ILogger;
	readonly #apps = new Map<string, RegisteredApp>();

	constructor(model: Model<StorageUsageDoc>, limits: LimitsManager, logger: ILogger) {
		this.#model = model;
		this.#limits = limits;
		this.#logger = logger;
	}

	registerApp(app: RegisteredApp): void {
		this.#apps.set(app.appId, app);
		this.#logger.logInfo(`StorageQuota: app "${app.appId}" registrada`);
	}

	/** Apps registradas con el mínimo resuelto para el contexto dado. */
	listApps(scope: QuotaScope): StorageAppInfo[] {
		return [...this.#apps.values()].map(({ appId, label }) => ({ appId, label, minBytes: getStorageAppMinBytes(appId, scope) }));
	}

	async checkAllowance(subject: QuotaSubject, appId: string, sizeBytes: number): Promise<QuotaCheckResult> {
		const [profile, doc] = await Promise.all([
			this.#limits.resolveQuotaProfile(subject),
			this.#model.findById(usageDocId(subject)).lean<(StorageUsageDoc & { apps: Record<string, StorageAppUsage> }) | null>(),
		]);
		const usedTotal = doc?.totalBytes ?? 0;
		const usedApp = doc?.apps?.[appId]?.bytes ?? 0;
		const minApp = getStorageAppMinBytes(appId, profile.scope);
		const limit = profile.effectiveLimit;

		const allowed = usedApp + sizeBytes <= minApp || limit === UNLIMITED_BYTES || usedTotal + sizeBytes <= limit;
		return {
			allowed,
			reason: allowed ? undefined : "quota_exceeded",
			usedTotal,
			usedApp,
			effectiveLimit: limit,
		};
	}

	async commit(subject: QuotaSubject, appId: string, bytes: number): Promise<boolean> {
		if (bytes <= 0) return true;
		const profile = await this.#limits.resolveQuotaProfile(subject);
		const limit = profile.effectiveLimit;
		const minApp = getStorageAppMinBytes(appId, profile.scope);
		const docId = usageDocId(subject);
		const appBytesField = `apps.${appId}.bytes`;
		const appCountField = `apps.${appId}.count`;

		// Asegurar el documento (no incrementa nada).
		await this.#model.updateOne(
			{ _id: docId },
			{ $setOnInsert: { userId: subject.userId, orgId: subject.orgId ?? null, totalBytes: 0, totalCount: 0 } },
			{ upsert: true }
		);

		const update = {
			$inc: { totalBytes: bytes, totalCount: 1, [appBytesField]: bytes, [appCountField]: 1 },
			$set: { updatedAt: new Date() },
		};

		// Sin límite efectivo: incremento directo (solo tracking).
		if (limit === UNLIMITED_BYTES) {
			const res = await this.#model.updateOne({ _id: docId }, update);
			return res.matchedCount > 0;
		}

		// Admisión condicional: dentro del mínimo garantizado de la app (campo
		// ausente cuenta como 0, válido solo si la subida entra en el mínimo) O
		// dentro del límite total del contexto.
		const appMinConds: Record<string, unknown>[] = [{ [appBytesField]: { $lte: minApp - bytes } }];
		if (bytes <= minApp) appMinConds.push({ [appBytesField]: { $exists: false } });

		const res = await this.#model.updateOne({ _id: docId, $or: [{ $or: appMinConds }, { totalBytes: { $lte: limit - bytes } }] }, update);
		return res.matchedCount > 0;
	}

	async release(subject: QuotaSubject, appId: string, bytes: number): Promise<void> {
		if (bytes <= 0) return;
		// Pipeline de agregación: clamp a ≥ 0 para tolerar releases duplicados o drift.
		await this.#model.updateOne({ _id: usageDocId(subject) }, [
			{
				$set: {
					totalBytes: { $max: [0, { $subtract: [{ $ifNull: ["$totalBytes", 0] }, bytes] }] },
					totalCount: { $max: [0, { $subtract: [{ $ifNull: ["$totalCount", 0] }, 1] }] },
					[`apps.${appId}.bytes`]: { $max: [0, { $subtract: [{ $ifNull: [`$apps.${appId}.bytes`, 0] }, bytes] }] },
					[`apps.${appId}.count`]: { $max: [0, { $subtract: [{ $ifNull: [`$apps.${appId}.count`, 0] }, 1] }] },
					updatedAt: "$$NOW",
				},
			},
		]);
	}

	async getUsage(subject: QuotaSubject): Promise<StorageUsageSnapshot> {
		const [profile, doc] = await Promise.all([
			this.#limits.resolveQuotaProfile(subject),
			this.#model.findById(usageDocId(subject)).lean<(StorageUsageDoc & { apps: Record<string, StorageAppUsage> }) | null>(),
		]);
		return {
			userId: subject.userId,
			orgId: subject.orgId ?? null,
			totalBytes: doc?.totalBytes ?? 0,
			totalCount: doc?.totalCount ?? 0,
			apps: doc?.apps ?? {},
			effectiveLimit: profile.effectiveLimit,
			updatedAt: doc?.updatedAt ? new Date(doc.updatedAt).toISOString() : undefined,
		};
	}

	/** Contadores del contexto de una org (un doc por miembro con uso en ese contexto). */
	async getOrgUsageRows(orgId: string): Promise<Array<{ userId: string; totalBytes: number; totalCount: number }>> {
		const docs = await this.#model
			.find({ orgId })
			.select({ userId: 1, totalBytes: 1, totalCount: 1 })
			.lean<Array<{ userId: string; totalBytes: number; totalCount: number }>>();
		return docs.map((d) => ({ userId: d.userId, totalBytes: d.totalBytes ?? 0, totalCount: d.totalCount ?? 0 }));
	}

	/**
	 * Reconstruye los contadores desde la fuente de verdad de cada app registrada
	 * (`computeUsage` agrega los attachments `ready` reales por contexto).
	 * Corrige drift por fail-open, releases perdidos o borrados legacy; los docs
	 * con key vieja (sin contexto) quedan en cero en el barrido.
	 */
	async reconcile(): Promise<{ apps: string[]; usersUpdated: number }> {
		const perSubject = new Map<string, { subject: QuotaSubject; total: { bytes: number; count: number }; apps: Record<string, StorageAppUsage> }>();
		const reconciled: string[] = [];

		for (const app of this.#apps.values()) {
			if (await this.#accumulateAppUsage(app, perSubject)) reconciled.push(app.appId);
		}
		if (!reconciled.length) return { apps: [], usersUpdated: 0 };

		const now = new Date();
		const ops = [...perSubject].map(([docId, entry]) => ({
			updateOne: {
				filter: { _id: docId },
				update: {
					$set: {
						userId: entry.subject.userId,
						orgId: entry.subject.orgId ?? null,
						totalBytes: entry.total.bytes,
						totalCount: entry.total.count,
						apps: entry.apps,
						updatedAt: now,
					},
				},
				upsert: true,
			},
		}));
		// Sujetos con contadores pero sin attachments reales → a cero.
		await this.#model.updateMany(
			{ _id: { $nin: [...perSubject.keys()] }, totalBytes: { $gt: 0 } },
			{ $set: { totalBytes: 0, totalCount: 0, apps: {}, updatedAt: now } }
		);
		if (ops.length) await this.#model.bulkWrite(ops as Parameters<Model<StorageUsageDoc>["bulkWrite"]>[0], { ordered: false });

		this.#logger.logOk(`StorageQuota: reconcile completado (${reconciled.join(", ")}; ${perSubject.size} sujeto(s))`);
		return { apps: reconciled, usersUpdated: perSubject.size };
	}

	/** Suma el uso real de una app al acumulador; false si la app no participa o falló. */
	async #accumulateAppUsage(
		app: RegisteredApp,
		perSubject: Map<string, { subject: QuotaSubject; total: { bytes: number; count: number }; apps: Record<string, StorageAppUsage> }>
	): Promise<boolean> {
		if (!app.computeUsage) return false;
		let rows: Array<{ userId: string; orgId: string | null; bytes: number; count: number }>;
		try {
			rows = await app.computeUsage();
		} catch (e) {
			this.#logger.logWarn(`StorageQuota: reconcile de "${app.appId}" falló: ${(e as Error).message}`);
			return false;
		}
		for (const row of rows) {
			if (!row.userId) continue;
			const subject: QuotaSubject = { userId: row.userId, orgId: row.orgId ?? null };
			const docId = usageDocId(subject);
			let entry = perSubject.get(docId);
			if (!entry) {
				entry = { subject, total: { bytes: 0, count: 0 }, apps: {} };
				perSubject.set(docId, entry);
			}
			entry.total.bytes += row.bytes;
			entry.total.count += row.count;
			entry.apps[app.appId] = { bytes: row.bytes, count: row.count };
		}
		return true;
	}
}
