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
}
