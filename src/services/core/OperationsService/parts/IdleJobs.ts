import type { ILogger } from "@interfaces/utils/ILogger.js";
import { assertScope, Scope, type CapabilityToken } from "@common/security/Capability.ts";
import type { IdleJobDefinition, IdleJobStatus, IIdleOrchestrator } from "@common/types/operations/IIdleOrchestrator.ts";
import { IdleScheduler, type SchedulerConfig } from "./IdleScheduler.ts";

/**
 * Superficie de **trabajos de momentos ociosos**: barridos que tienen que existir pero que nadie
 * está esperando (verificar contenido ya subido, reconciliar contadores, purgar).
 *
 * Vive acá y no en el `index.ts` para que el shell siga siendo una fachada delgada: el gate por
 * scope, la config y el ciclo de vida del planificador son de esta parte.
 */
export class IdleJobs implements IIdleOrchestrator {
	#scheduler: IdleScheduler | null = null;

	/**
	 * Arranca el planificador con el bloque `private` del `config.json` del servicio.
	 *
	 * @param claimLeader pide el rol de "nodo que corre los trabajos de fondo" para el turno en
	 *   curso. Lo provee el servicio, que es el dueño del lease.
	 */
	start(priv: Record<string, unknown>, logger: ILogger, claimLeader: () => Promise<boolean>): SchedulerConfig {
		const config: SchedulerConfig = {
			tickMs: positive(priv.idleTickSeconds, 30) * 1000,
			defaultIntervalMs: positive(priv.idleDefaultIntervalSeconds, 300) * 1000,
			defaultBatchBudgetMs: positive(priv.idleBatchBudgetMs, 2000),
			maxBackoffMs: positive(priv.idleMaxBackoffMinutes, 360) * 60_000,
			maxConsecutiveFailures: positive(priv.idleMaxConsecutiveFailures, 5),
			maxCpuPercent: positive(priv.idleMaxCpuPercent, 35),
			maxLoadPerCore: positive(priv.idleMaxLoadPerCore, 0.7),
		};
		this.#scheduler = new IdleScheduler(config, logger, claimLeader);
		this.#scheduler.start();
		return config;
	}

	stop(): void {
		this.#scheduler?.stop();
		this.#scheduler = null;
	}

	registerIdleJob(cap: CapabilityToken, job: IdleJobDefinition): void {
		assertScope(cap, Scope.IdleRegister);
		this.#require().register(ownerOf(cap), job);
	}

	/**
	 * Dar de baja sin planificador **no es un error**: es el estado que se buscaba.
	 *
	 * Los productores dan de baja sus trabajos en su `stop()`, y el planificador se para antes que
	 * ellos (`OperationsService` es kernelMode 45 y los que registran trabajos vienen después), así
	 * que exigirlo hacía que cada cierre ordenado terminara con cinco `Error deteniendo Service …`
	 * que no describían ningún problema — y que tapaban a los que sí. Registrar contra un
	 * planificador muerto sigue lanzando: eso sí es un error de programación.
	 */
	unregisterIdleJob(cap: CapabilityToken, id: string): boolean {
		assertScope(cap, Scope.IdleRegister);
		return this.#scheduler?.unregister(ownerOf(cap), id) ?? false;
	}

	unregisterIdleJobs(cap: CapabilityToken): number {
		assertScope(cap, Scope.IdleRegister);
		return this.#scheduler?.unregisterOwner(ownerOf(cap)) ?? 0;
	}

	idleJobs(): IdleJobStatus[] {
		return this.#scheduler?.list() ?? [];
	}

	#require(): IdleScheduler {
		if (!this.#scheduler) throw new Error("El planificador de trabajos ociosos no está inicializado");
		return this.#scheduler;
	}
}

/** El dueño sale de la capability, que es infalsificable: nadie registra a nombre de otro. */
function ownerOf(cap: CapabilityToken): string {
	return typeof cap === "symbol" ? "kernel" : cap.owner;
}

function positive(raw: unknown, fallback: number): number {
	const n = Number(raw);
	return Number.isFinite(n) && n > 0 ? n : fallback;
}
