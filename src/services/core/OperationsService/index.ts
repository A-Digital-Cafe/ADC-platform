import { type Model } from "mongoose";
import { BaseService } from "../../BaseService.js";
import type RedisProvider from "../../../providers/queue/redis/index.ts";
import type MongoProvider from "../../../providers/object/mongo/index.ts";
import { IdempotencyError } from "@common/types/custom-errors/IdempotencyError.ts";
import { isSagaStep, type Step, type StepperDocument, type StepperResult } from "./types.js";
import { stepperSchema } from "./domain/stepperSchema.js";
import { executeSaga } from "./helpers/executeSaga.js";
import { CircuitBreaker } from "./parts/CircuitBreaker.ts";
import { OnlyKernel } from "../../../utils/decorators/OnlyKernel.ts";

export type { Step, SagaStep, StepFunction, StepperResult } from "./types.js";
export { CircuitBreaker, CircuitState, type CircuitBreakerConfig } from "./parts/CircuitBreaker.ts";

export const HTTP_CHECK_TTL_SECONDS = 120; // 2min
export default class OperationsService extends BaseService {
	public readonly name = "OperationsService";

	/** Per-operation circuit breaker - used by consumers only */
	public readonly circuitBreaker: CircuitBreaker;

	#redis: RedisProvider | null = null;
	#stepperModel: Model<StepperDocument> | null = null;

	constructor(kernel?: any, options?: any) {
		super(kernel, options);
		this.circuitBreaker = new CircuitBreaker();
	}

	@OnlyKernel()
	async start(kernelKey: symbol): Promise<void> {
		await super.start(kernelKey);
		this.#redis = this.getMyProvider<RedisProvider>("queue/redis");
		const mongo = this.getMyProvider<MongoProvider>("object/mongo");
		await mongo.connect(kernelKey);
		this.#stepperModel = mongo.createModel<StepperDocument>("OperationStep", stepperSchema);
		this.logger.logOk("OperationsService iniciado");
	}

	/**
	 * Executes a resumable multi-step pipeline.
	 * Steps already completed (tracked in MongoDB by `cmd:id`) are skipped.
	 * Returns `null` on success, or the failing step index to allow retry.
	 */
	async stepper(idx: number, cmd: string, id: string, steps: Step[]): Promise<StepperResult> {
		const docId = `${cmd}:${id}`;
		const model = this.#stepperModel!;

		await model.findOneAndUpdate({ _id: docId }, { $setOnInsert: { currentIdx: -1, createdAt: new Date() } }, { upsert: true });

		for (let i = idx; i < steps.length; i++) {
			const doc = await model.findById(docId).lean();
			if (doc && doc.currentIdx >= i) {
				this.logger.logDebug(`[stepper] ${docId} step ${i} skipped`);
				continue;
			}

			try {
				const step = steps[i];
				if (isSagaStep(step)) await executeSaga(step, docId, i, this.logger);
				else await step();
			} catch (error: any) {
				this.logger.logError(`[stepper] ${docId} failed at step ${i}: ${error.message}`);
				return i;
			}

			await model.updateOne({ _id: docId }, { $set: { currentIdx: i } });
		}

		return null;
	}

	/**
	 * Idempotency guard for HTTP mutations.
	 * Blocks duplicate calls with the same `cmd+id` within a 2-minute window.
	 * Deletes the key on failure so the client can retry with the same key.
	 */
	async httpCheck<T>(cmd: string, id: string | number, method: () => Promise<T>): Promise<T> {
		const redis = this.#redis!;
		const key = `http:${cmd}:${id}`;

		if (await redis.exists(key)) {
			throw new IdempotencyError(409, "IDEMPOTENCY_RUNNING", "Operation already in progress or recently completed", {
				retryAfterSeconds: HTTP_CHECK_TTL_SECONDS,
			});
		}

		await redis.setex(key, HTTP_CHECK_TTL_SECONDS, "running");
		try {
			const result = await method();
			await redis.setex(key, HTTP_CHECK_TTL_SECONDS, "completed");
			return result;
		} catch (error) {
			await redis.del(key);
			throw error;
		}
	}

	@OnlyKernel()
	async stop(kernelKey: symbol): Promise<void> {
		this.#redis = null;
		this.#stepperModel = null;
		await super.stop(kernelKey);
	}
}
