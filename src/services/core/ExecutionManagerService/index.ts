import * as os from "node:os";
import { Worker } from "node:worker_threads";
import { BaseService } from "../../BaseService.js";
import { assignWorker } from "../../../utils/decorators/Distributed.js";
import { OnlyKernel } from "../../../utils/decorators/OnlyKernel.ts";
import type { WorkerInfo, SystemLoad, IExecutionManager } from "./types.js";
import crypto from "node:crypto";

/**
 * ExecutionManagerService - Gestiona la ejecución distribuida de módulos
 *
 * **Modo Kernel:**
 * Este servicio se ejecuta en modo kernel (global: true en config.json),
 * lo que significa que está disponible para toda la plataforma.
 *
 * **Funcionalidades:**
 * - Administra un pool de workers dinámico
 * - Mide la carga del sistema (CPU, memoria)
 * - Distribuye la ejecución de métodos entre workers según la carga
 * - Balancea la carga entre workers disponibles
 *
 * **Preparado para clusterización futura:**
 * - La arquitectura está diseñada para soportar nodos remotos
 * - Los "workers" pueden ser reemplazados por conexiones a otros dispositivos
 * - El sistema de asignación es agnóstico al tipo de ejecutor (worker/remoto)
 *
 * @example
 * ```typescript
 * const execManager = kernel.getService<IExecutionManager>("execution-manager");
 *
 * // Asignar worker óptimo a un servicio distribuido
 * await execManager.assignOptimalWorker(myService);
 *
 * // El servicio ahora ejecutará métodos en el worker asignado
 * await myService.heavyComputation(); // Se ejecuta en worker
 * ```
 */
export default class ExecutionManagerService extends BaseService implements IExecutionManager {
	public readonly name = "ExecutionManagerService";

	private workerPool: WorkerInfo[] = [];
	private readonly maxWorkers: number;
	private readonly minWorkers: number;
	private loadCheckInterval: NodeJS.Timeout | null = null;

	constructor(kernel: any, options?: any) {
		super(kernel, options);

		// Configuración del pool de workers
		const cpuCount = os.cpus().length;
		this.maxWorkers = options?.maxWorkers || Math.max(2, cpuCount - 1);
		this.minWorkers = options?.minWorkers || Math.min(2, cpuCount);

		this.logger.logInfo(`Configurado para ${this.minWorkers}-${this.maxWorkers} workers (CPUs: ${cpuCount})`);
	}

	@OnlyKernel()
	async start(kernelKey: symbol): Promise<void> {
		await super.start(kernelKey);

		// Inicializar pool mínimo de workers
		for (let i = 0; i < this.minWorkers; i++) {
			this.#createWorker();
		}

		// Iniciar monitoreo de carga del sistema
		this.#startLoadMonitoring();

		this.logger.logOk("ExecutionManagerService iniciado");
	}

	@OnlyKernel()
	async stop(kernelKey: symbol): Promise<void> {
		await super.stop(kernelKey);
		// Detener monitoreo
		if (this.loadCheckInterval) {
			clearInterval(this.loadCheckInterval);
			this.loadCheckInterval = null;
		}

		// Terminar todos los workers
		for (const workerInfo of this.workerPool) {
			await workerInfo.worker.terminate();
		}
		this.workerPool = [];

		this.logger.logInfo("ExecutionManagerService detenido");
	}

	async getStats(): Promise<{ workers: number; systemLoad: SystemLoad; activeTasks: number }> {
		return {
			workers: this.workerPool.length,
			systemLoad: this.#getSystemLoad(),
			activeTasks: this.workerPool.reduce((sum, w) => sum + w.taskCount, 0),
		};
	}

	async assignOptimalWorker(instance: any): Promise<void> {
		return this.#assignOptimalWorker(instance);
	}

	releaseWorker(instance: any): void {
		assignWorker(instance, null);
	}

	/**
	 * Crea un nuevo worker en el pool
	 */
	#createWorker(): WorkerInfo {
		const workerId = `worker-${Date.now()}-${crypto.randomBytes(6).toString("base64url").slice(2, 9)}`;

		// TODO: En el futuro, aquí se podría crear una conexión a un nodo remoto
		// en lugar de un Worker local
		const worker = new Worker(
			`
			const { parentPort } = require('worker_threads');
			
			parentPort.on('message', async (msg) => {
				try {
					// Aquí se ejecutaría el método solicitado
					// Por ahora es un placeholder
					parentPort.postMessage({
						id: msg.id,
						type: 'response',
						result: null
					});
				} catch (error) {
					parentPort.postMessage({
						id: msg.id,
						type: 'error',
						error: error.message
					});
				}
			});
		`,
			{ eval: true }
		);

		const workerInfo: WorkerInfo = {
			worker,
			id: workerId,
			taskCount: 0,
			createdAt: Date.now(),
		};

		this.workerPool.push(workerInfo);
		this.logger.logDebug(`Worker creado: ${workerId}`);

		return workerInfo;
	}

	/**
	 * Asigna el worker óptimo a un módulo según la carga actual
	 */
	async #assignOptimalWorker(instance: any): Promise<void> {
		const systemLoad = this.#getSystemLoad();

		// Si la carga es baja, ejecutar localmente
		if (systemLoad.avgLoad < 0.5 && this.workerPool.length === 0) {
			this.logger.logDebug("Carga baja, ejecutando localmente");
			assignWorker(instance, null);
			return;
		}

		// Encontrar el worker con menos tareas
		let optimalWorker = this.workerPool[0];
		for (const workerInfo of this.workerPool) {
			if (workerInfo.taskCount < optimalWorker.taskCount) {
				optimalWorker = workerInfo;
			}
		}

		// Si todos los workers están sobrecargados y no hemos llegado al máximo,
		// crear un nuevo worker
		if (optimalWorker.taskCount > 10 && this.workerPool.length < this.maxWorkers) {
			optimalWorker = this.#createWorker();
		}

		// Asignar el worker
		optimalWorker.taskCount++;
		assignWorker(instance, optimalWorker.worker);

		this.logger.logDebug(`Worker ${optimalWorker.id} asignado (tareas: ${optimalWorker.taskCount})`);
	}

	/**
	 * Obtiene la carga actual del sistema
	 */
	#getSystemLoad(): SystemLoad {
		const cpus = os.cpus();
		const cpuUsage = cpus.map((cpu) => {
			const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
			const idle = cpu.times.idle;
			return 1 - idle / total;
		});

		const avgLoad = cpuUsage.reduce((a, b) => a + b, 0) / cpuUsage.length;
		const freeMemory = os.freemem();
		const totalMemory = os.totalmem();

		return {
			cpuUsage,
			avgLoad,
			freeMemory,
			totalMemory,
		};
	}

	/**
	 * Inicia el monitoreo periódico de carga del sistema
	 */
	#startLoadMonitoring(): void {
		this.loadCheckInterval = setInterval(() => {
			const load = this.#getSystemLoad();

			// Si la carga es alta y tenemos pocos workers, crear más
			if (load.avgLoad > 0.8 && this.workerPool.length < this.maxWorkers) {
				this.logger.logDebug(`Carga alta (${(load.avgLoad * 100).toFixed(1)}%), creando worker adicional`);
				this.#createWorker();
			}

			// Si la carga es baja y tenemos workers ociosos, reducir
			if (load.avgLoad < 0.3 && this.workerPool.length > this.minWorkers) {
				const idleWorkers = this.workerPool.filter((w) => w.taskCount === 0);
				if (idleWorkers.length > 0) {
					const workerToRemove = idleWorkers[0];
					workerToRemove.worker.terminate();
					this.workerPool = this.workerPool.filter((w) => w.id !== workerToRemove.id);
					this.logger.logDebug(`Worker ${workerToRemove.id} terminado por baja carga`);
				}
			}
		}, 5000); // Revisar cada 5 segundos
	}
}

// Re-exportar tipos
export type { WorkerInfo, SystemLoad, IExecutionManager } from "./types.js";
