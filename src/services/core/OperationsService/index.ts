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
import type { IOperationsService } from "@common/types/operations/IOperationsService.ts";
import type { IdleJobDefinition, IdleJobStatus, IIdleOrchestrator } from "@common/types/operations/IIdleOrchestrator.ts";
import type { CapabilityToken } from "@common/security/Capability.ts";
import { IdleJobs } from "./parts/IdleJobs.ts";
import { Leadership } from "./parts/Leadership.ts";

export type { Step, SagaStep, StepFunction, StepperResult } from "./types.js";
export { CircuitBreaker, CircuitState, type CircuitBreakerConfig } from "./parts/CircuitBreaker.ts";

export const HTTP_CHECK_TTL_SECONDS = 120; // 2min

/** Nombre del rol de "nodo que corre los trabajos de fondo" (ver `#claimIdleRole`). */
const IDLE_ROLE = "operations.idle-scheduler";

/**
 * Coordina **cuándo** corre el trabajo de la plataforma, no cómo se hace: `httpCheck`/`stepper`
 * para lo que alguien pidió, {@link IIdleOrchestrator} para lo que nadie está esperando.
 */
export default class OperationsService extends BaseService implements IOperationsService, IIdleOrchestrator {
	public readonly name = "OperationsService";

	/** Per-operation circuit breaker - used by consumers only */
	public readonly circuitBreaker: CircuitBreaker;

	readonly #idle = new IdleJobs();
	#redis: RedisProvider | null = null;
	#leadership: Leadership | null = null;
	#stepperModel: Model<StepperDocument> | null = null;
	/** TTL del rol de trabajos de fondo. Se calcula del intervalo de turno al arrancar. */
	#idleRoleTtl = 120;

	constructor(kernel?: any, options?: any) {
		super(kernel, options);
		this.circuitBreaker = new CircuitBreaker();
	}

	@OnlyKernel()
	async start(kernelKey: symbol): Promise<void> {
		await super.start(kernelKey);
		this.#redis = this.getMyProvider<RedisProvider>("queue/redis");
		this.#leadership = new Leadership(this.#redis, this.logger);
		const mongo = this.getMyProvider<MongoProvider>("object/mongo");
		await mongo.whenReady();
		this.#stepperModel = mongo.createModel<StepperDocument>("OperationStep", stepperSchema);

		const idle = this.#idle.start((this.config?.private ?? {}) as Record<string, unknown>, this.logger, () =>
			this.#claimIdleRole()
		);
		// Cuatro turnos de holgura: el rol se renueva en cada turno, así que sólo vence si el nodo
		// dejó de tickear (saturado, caído o apagándose). Demasiado corto lo haría rotar por un
		// turno perdido; demasiado largo dejaría el trabajo de fondo parado tras una caída.
		this.#idleRoleTtl = Math.max(60, Math.ceil((idle.tickMs * 4) / 1000));
		this.logger.logOk(
			`OperationsService iniciado (trabajos ociosos: turno cada ${idle.tickMs / 1000}s, ocioso = CPU ≤ ${idle.maxCpuPercent}%)`
		);
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
	 *
	 * La reserva es un `SET NX` atómico (ver `RedisProvider.setIfAbsent`): con `exists()` +
	 * `setex()` dos requests en vuelo verían la clave libre y ejecutarían las dos.
	 */
	async httpCheck<T>(cmd: string, id: string | number, method: () => Promise<T>): Promise<T> {
		const redis = this.#redis!;
		const key = `http:${cmd}:${id}`;

		if (!(await redis.setIfAbsent(key, "running", HTTP_CHECK_TTL_SECONDS))) {
			throw new IdempotencyError(409, "IDEMPOTENCY_RUNNING", "Operation already in progress or recently completed", {
				retryAfterSeconds: HTTP_CHECK_TTL_SECONDS,
			});
		}

		try {
			const result = await method();
			await redis.setex(key, HTTP_CHECK_TTL_SECONDS, "completed");
			return result;
		} catch (error) {
			await redis.del(key);
			throw error;
		}
	}

	/**
	 * Corre `fn` sólo en el nodo que consiga el lease de `name`; en los demás no hace nada y
	 * devuelve `undefined`. Es lo que evita que cada `setInterval` que escribe se ejecute una vez
	 * por nodo. Detalle del contrato (y por qué el trabajo tiene que seguir siendo idempotente) en
	 * `parts/Leadership.ts`.
	 */
	async withLeadership<T>(name: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T | undefined> {
		// Sin Redis (arranque degradado) no hay coordinación posible. Se corre igual: en un
		// despliegue de un nodo —el caso normal— negarse sería peor que el riesgo que evita.
		if (!this.#leadership) return fn();
		return this.#leadership.withLeadership(name, ttlSeconds, fn);
	}

	/** Leases que este nodo sostiene ahora mismo. Lo lee el panel de nodos. */
	heldLeases(): string[] {
		return this.#leadership?.heldLeases() ?? [];
	}

	/**
	 * Pide para este nodo el rol de "el que corre los trabajos de fondo", una vez por turno.
	 *
	 * Un **rol sostenido** y no un lease por turno: varios trabajos llevan en memoria del proceso
	 * la marca de lo que ya hicieron —el aviso de plazo de una brecha, por ejemplo, recuerda a
	 * quién ya avisó— y rotar de nodo entre turnos la volvería a cero, que es el mismo aviso
	 * repetido que el lease venía a evitar.
	 */
	async #claimIdleRole(): Promise<boolean> {
		// Sin Redis no hay coordinación: se trabaja igual, como en `withLeadership`.
		return this.#leadership ? this.#leadership.claimLeadership(IDLE_ROLE, this.#idleRoleTtl) : true;
	}

	// ── Trabajos de momentos ociosos (IIdleOrchestrator) ──────────────────────
	// Delegación pura: el gate por scope y el planificador viven en `parts/IdleJobs.ts`.

	registerIdleJob(cap: CapabilityToken, job: IdleJobDefinition): void {
		this.#idle.registerIdleJob(cap, job);
	}

	unregisterIdleJob(cap: CapabilityToken, id: string): boolean {
		return this.#idle.unregisterIdleJob(cap, id);
	}

	unregisterIdleJobs(cap: CapabilityToken): number {
		return this.#idle.unregisterIdleJobs(cap);
	}

	idleJobs(): IdleJobStatus[] {
		return this.#idle.idleJobs();
	}

	@OnlyKernel()
	async stop(kernelKey: symbol): Promise<void> {
		this.#idle.stop();
		// Baja explícita del rol de fondo: sin esto el trabajo del clúster queda parado hasta que
		// venza el lease, aunque otro nodo esté listo para tomarlo ya mismo.
		await this.#leadership?.releaseLeadership(IDLE_ROLE).catch(() => undefined);
		// Corta los renovadores: si no, un lease de este nodo se seguiría renovando después de
		// pararlo y ningún otro podría tomar el trabajo hasta el TTL siguiente.
		this.#leadership?.stop();
		this.#leadership = null;
		this.#redis = null;
		this.#stepperModel = null;
		await super.stop(kernelKey);
	}
}
