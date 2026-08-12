/**
 * Contrato compartido del message queue: vive en `@interfaces` para que los
 * consumidores (p.ej. EndpointManagerService) no dependan de los internos de
 * este provider. Acá sólo se re-exporta + la config específica del provider.
 */
export type { OperationMessage, TopologyOptions, ConsumerOptions } from "@interfaces/modules/providers/IMessageQueue.js";

/** Configuration for the RabbitMQ provider */
export interface RabbitMQProviderConfig {
	url?: string;
	defaultPrefetch?: number;
	defaultConcurrency?: number;
	maxRetries?: number;
	/** Delay per retry level in ms - forms exponential backoff via dedicated TTL queues */
	retryDelaysMs?: number[];
	/**
	 * Tipo de las colas de trabajo. `classic` (default) con un broker de un nodo; `quorum` con un
	 * clúster, donde es lo correcto (las colas espejadas están deprecadas).
	 *
	 * ⚠️ No se puede cambiar en caliente: redeclarar una cola existente con otro tipo falla con
	 * `PRECONDITION_FAILED`. Migrar exige drenar y borrar las colas `q.<servicio>.*`.
	 */
	queueType?: "classic" | "quorum";
}
