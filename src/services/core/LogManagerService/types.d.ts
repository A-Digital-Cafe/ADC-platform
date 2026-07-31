import type { LogPage, LogQuery } from "@common/utils/log-buffer.ts";

export interface LogManagerConfig {
	retentionDays: number;
	retentionCount?: number;
	logsDir: string;
}

/**
 * Superficie del servicio de logs. Los archivos de `temp/logs` (dev-servers de UI) sólo se
 * rotan; lo consultable es el buffer en memoria del proceso.
 */
export interface ILogManagerService {
	/** Últimas líneas del proceso, filtradas y paginadas por `seq`. */
	queryBuffer(filter: LogQuery): LogPage;
	/** Borra archivos de log por antigüedad y por cantidad. */
	cleanupLogs(): Promise<void>;
	getLogsDir(): string;
}
