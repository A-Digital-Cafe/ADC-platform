import type { LogPage, LogQuery } from "@common/utils/log-buffer.ts";
import type { EndpointCtx } from "@services/core/EndpointManagerService/index.js";

export interface LogManagerConfig {
	retentionDays: number;
	retentionCount?: number;
	logsDir: string;
}

/**
 * Página del buffer con el nodo que la produjo. Con varios nodos el "de dónde" es parte del
 * dato: sin él, dos lecturas seguidas pueden venir de procesos distintos y leerse como una sola.
 */
export interface NodeLogPage extends LogPage {
	nodeId: string;
}

/** Lo que el fan-in necesita del request original: credenciales del operador e IP real. */
export type LogRequestOrigin = Pick<EndpointCtx<never, unknown>, "headers" | "ip">;

/**
 * Superficie del servicio de logs. Los archivos de `temp/logs` (dev-servers de UI) sólo se
 * rotan; lo consultable es el buffer en memoria del proceso.
 */
export interface ILogManagerService {
	/** Últimas líneas del proceso, filtradas y paginadas por `seq`. */
	queryBuffer(filter: LogQuery): LogPage;
	/** Lo mismo, pero del nodo pedido: sin `node` (o con el propio) no sale del proceso. */
	queryBufferAt(node: string | undefined, filter: LogQuery, origin: LogRequestOrigin): Promise<NodeLogPage>;
	/** Borra archivos de log por antigüedad y por cantidad. */
	cleanupLogs(): Promise<void>;
	getLogsDir(): string;
}
