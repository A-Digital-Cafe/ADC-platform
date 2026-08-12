/**
 * Contrato público del **OperationsService** (clase principal).
 *
 * Vive en `@common` para que otros servicios consuman las primitivas de saga
 * (`stepper`), resiliencia HTTP (`httpCheck`) y el `circuitBreaker` por **interfaz**
 * sin importar la clase concreta de `@services`. La clase concreta hace
 * `implements IOperationsService`.
 */

import type { Step, StepperResult } from "@services/core/OperationsService/types.js";
import type { CircuitBreaker } from "@services/core/OperationsService/parts/CircuitBreaker.js";

export interface IOperationsService {
	/** Circuit breaker compartido para envolver handlers/llamadas externas. */
	readonly circuitBreaker: CircuitBreaker;
	/** Ejecuta un pipeline reanudable de pasos (saga) desde `idx`. */
	stepper(idx: number, cmd: string, id: string, steps: Step[]): Promise<StepperResult>;
	/** Envuelve una llamada HTTP saliente con la política de resiliencia. */
	httpCheck<T>(cmd: string, id: string | number, method: () => Promise<T>): Promise<T>;
	/**
	 * Corre `fn` **sólo en el nodo que consiga el lease** de `name`; en los demás devuelve
	 * `undefined` sin ejecutar nada. Es la primitiva con la que un trabajo periódico deja de
	 * correr una vez por nodo.
	 *
	 * `ttlSeconds` tiene que ser holgadamente mayor que el intervalo entre turnos del trabajo. El
	 * lease se renueva solo mientras `fn` corre y se libera al terminar, incluso si lanza. Como es
	 * un lease y no un candado, **`fn` tiene que seguir siendo idempotente**: en la ventana de
	 * vencimiento dos nodos podrían solaparse.
	 */
	withLeadership<T>(name: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T | undefined>;
	/** Leases que este nodo sostiene ahora mismo (diagnóstico). */
	heldLeases(): string[];
}
