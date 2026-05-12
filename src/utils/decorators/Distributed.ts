import { Worker } from "node:worker_threads";
import { Logger } from "../logger/Logger.js";
import crypto from "node:crypto";

/**
 * Símbolo para almacenar el worker asignado en la instancia
 */
const WORKER_INSTANCE = Symbol("workerInstance");

/**
 * Símbolo para indicar que una clase ya está distribuida
 */
const IS_DISTRIBUTED = Symbol("isDistributed");

/**
 * @public
 * Decorador @Distributed para clases que soportan ejecución distribuida.
 *
 * Este decorador permite que los métodos de una clase se ejecuten en workers
 * para procesamiento paralelo. El ExecutionManagerService asigna workers
 * dinámicamente según la carga del sistema.
 *
 * **Funcionalidad:**
 * - Si la instancia tiene un worker asignado, los métodos se ejecutan en ese worker
 * - El worker puede cambiar en runtime (asignación dinámica)
 * - Si no hay worker, los métodos se ejecutan localmente
 *
 * **Preparado para clusterización:**
 * - El sistema de mensajería es compatible con comunicación remota
 * - En el futuro, los "workers" pueden ser nodos remotos
 *
 * @example
 * ```typescript
 * @Distributed
 * class MyService extends BaseService {
 *   async heavyComputation(data: any): Promise<any> {
 *     // Este método puede ejecutarse en un worker si hay uno asignado
 *     return processData(data);
 *   }
 * }
 *
 * // El ExecutionManagerService asigna workers automáticamente
 * const service = await kernel.getService("my-service");
 * await service.heavyComputation(data); // Se ejecuta donde el manager decida
 * ```
 */
export function Distributed<T extends new (...args: any[]) => any>(constructor: T): T {
	// Verificar que no se aplique el decorador dos veces
	if ((constructor as any)[IS_DISTRIBUTED]) {
		Logger.warn(`[Distributed] La clase ${constructor.name} ya está distribuida, ignorando decorador duplicado`);
		return constructor;
	}

	// Marcar la clase como distribuida
	(constructor as any)[IS_DISTRIBUTED] = true;

	return class extends constructor {
		constructor(...args: any[]) {
			super(...args);

			// Inicializar el worker como null
			(this as any)[WORKER_INSTANCE] = null;

			// Crear el proxy para interceptar las llamadas
			return this.#createProxy();
		}

		/**
		 * Crea un proxy que intercepta todas las llamadas a métodos
		 */
		#createProxy(): any {
			return new Proxy(this, {
				get: (target: any, prop: string | symbol, receiver: any) => {
					const originalValue = Reflect.get(target, prop, receiver);

					if (typeof originalValue !== "function" || typeof prop === "symbol") {
						return originalValue;
					}

					const skipMethods = ["constructor", "start", "stop"];
					if (skipMethods.includes(prop)) {
						return originalValue;
					}

					return (...args: any[]) => this.#handleMethodCall(prop.toString(), args, originalValue, target);
				},

				set: (target: any, prop: string | symbol, value: any, receiver: any) => {
					if (prop === "worker") {
						target[WORKER_INSTANCE] = value;
						return true;
					}
					return Reflect.set(target, prop, value, receiver);
				},
			});
		}

		/**
		 * Maneja la llamada a un método decidiendo si ejecutarlo local o en worker
		 */
		// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
		async #handleMethodCall(method: string, args: any[], originalMethod: Function, target: any): Promise<any> {
			const worker: Worker | null = (this as any)[WORKER_INSTANCE];

			// Si hay un worker asignado, ejecutar en el worker
			if (worker) {
				Logger.debug(`[Distributed] Ejecutando '${method}' en worker`);

				return new Promise((resolve, reject) => {
					const messageId = `${Date.now()}-${crypto.randomBytes(6).toString("base64url").slice(2, 9)}`;

					// Listener para la respuesta del worker
					const messageHandler = (message: any) => {
						if (message && message.id === messageId) {
							worker.off("message", messageHandler);

							if (message.type === "response") {
								resolve(message.result);
							} else if (message.type === "error") {
								reject(new Error(message.error));
							}
						}
					};

					// Listener para errores del worker
					const errorHandler = (error: Error) => {
						worker.off("message", messageHandler);
						worker.off("error", errorHandler);
						reject(error);
					};

					worker.on("message", messageHandler);
					worker.on("error", errorHandler);

					// Enviar el mensaje al worker
					worker.postMessage({
						id: messageId,
						type: "request",
						method,
						args,
					});

					// Timeout de 30 segundos
					setTimeout(() => {
						worker.off("message", messageHandler);
						worker.off("error", errorHandler);
						reject(new Error(`Timeout esperando respuesta del worker para método '${method}'`));
					}, 30000);
				});
			}

			// Sin worker: ejecutar localmente
			return originalMethod.apply(target, args);
		}
	};
}

/**
 * Asigna un worker a una instancia distribuida en runtime.
 * El ExecutionManagerService usa esta función para distribuir la carga.
 *
 * @param instance - Instancia del módulo distribuido
 * @param worker - Worker a asignar (o null para ejecución local)
 */
export function assignWorker(instance: any, worker: Worker | null): void {
	instance.worker = worker;
}

/**
 * Obtiene el worker asignado a una instancia (si tiene)
 *
 * @param instance - Instancia del módulo distribuido
 * @returns Worker asignado o null
 */
export function getAssignedWorker(instance: any): Worker | null {
	return instance[WORKER_INSTANCE] || null;
}
