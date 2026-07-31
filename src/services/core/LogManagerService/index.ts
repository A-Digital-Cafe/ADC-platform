import * as fs from "node:fs/promises";
import * as path from "node:path";
import { BaseService } from "../../BaseService.js";
import { Kernel } from "../../../kernel.js";
import { ILogManagerService } from "./types.js";
import { ModuleTypes } from "../../../utils/registry/ModuleRegistry.js";
import { OnlyKernel } from "../../../utils/decorators/OnlyKernel.ts";
import { EnableEndpoints, DisableEndpoints, type EndpointCtx } from "../EndpointManagerService/index.js";
import { AuthError } from "@common/types/custom-errors/AuthError.ts";
import { logBuffer, type LogPage, type LogQuery } from "@common/utils/log-buffer.ts";
import { LogsEndpoints } from "./endpoints/logs.ts";

/**
 * Dueño de los logs de la plataforma, en sus dos formas:
 *
 * - **Archivos en disco** (`temp/logs/**`, que escriben los dev-servers de UI): rotación
 *   y limpieza por antigüedad y por cantidad.
 * - **Buffer en memoria del proceso**: las últimas N líneas de todos los módulos, que
 *   sirve la consulta de `GET /api/logs`.
 *
 * El buffer NO vive acá sino en `@common/utils/log-buffer.ts`: tiene que existir desde el `import`
 * para capturar el arranque del kernel y de los servicios `kernelMode`. Este servicio es el dueño
 * de la **lectura**; el único que escribe es `ConsoleLogger`.
 */
export default class LogManagerService extends BaseService implements ILogManagerService {
	public readonly name = "LogManagerService";
	private cleanupInterval: NodeJS.Timeout | null = null;

	constructor(kernel: Kernel, options?: any) {
		super(kernel, options);
	}

	@OnlyKernel()
	@EnableEndpoints({ managers: () => [LogsEndpoints] })
	async start(kernelKey: symbol): Promise<void> {
		await super.start(kernelKey);
		LogsEndpoints.init(this);

		// Ensure logs directory exists
		const logsDir = this.getLogsDir();
		try {
			await fs.mkdir(logsDir, { recursive: true });
		} catch (error: any) {
			this.logger.logError(`Could not create logs directory: ${error.message}`);
		}

		// Run cleanup on start
		await this.cleanupLogs();

		// Schedule daily cleanup
		this.cleanupInterval = setInterval(
			() => {
				this.cleanupLogs();
			},
			24 * 60 * 60 * 1000
		);

		this.logger.logOk("LogManagerService started");
	}

	@OnlyKernel()
	@DisableEndpoints()
	async stop(kernelKey: symbol): Promise<void> {
		await super.stop(kernelKey);
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
		}
	}

	getLogsDir(moduleType?: ModuleTypes): string {
		const configDir = this.config.custom?.logsDir || "temp/logs";
		if (!moduleType) return path.resolve(process.cwd(), configDir);
		return path.resolve(process.cwd(), moduleType, configDir);
	}

	/**
	 * Delete logs older than the configured retention days or count
	 */
	async cleanupLogs(): Promise<void> {
		const retentionDays = this.config.custom?.retentionDays || 3;
		const retentionCount = this.config.custom?.retentionCount || 10;
		const logsDir = this.getLogsDir();
		const now = Date.now();
		const maxAge = retentionDays * 24 * 60 * 60 * 1000;

		this.logger.logInfo(`Cleaning up logs (older than ${retentionDays} days or > ${retentionCount} files) in ${logsDir}`);

		try {
			await this.#processDirectoryForCleanup(logsDir, now, maxAge, retentionCount);
		} catch (error: any) {
			this.logger.logError(`Error during log cleanup: ${error.message}`);
		}
	}

	async #processDirectoryForCleanup(dir: string, now: number, maxAge: number, retentionCount: number) {
		try {
			const entries = await fs.readdir(dir, { withFileTypes: true });

			// Separate files and directories
			const files: { name: string; path: string; time: number }[] = [];

			for (const entry of entries) {
				const fullPath = path.join(dir, entry.name);

				if (entry.isDirectory()) {
					// Recursive call for subdirectories
					await this.#processDirectoryForCleanup(fullPath, now, maxAge, retentionCount);

					// Try to remove empty directories
					try {
						const remaining = await fs.readdir(fullPath);
						if (remaining.length === 0) {
							await fs.rmdir(fullPath);
						}
					} catch {
						// ignore
					}
				} else {
					// Collect file stats
					const stats = await fs.stat(fullPath);
					files.push({
						name: entry.name,
						path: fullPath,
						time: stats.mtimeMs,
					});
				}
			}

			// 1. Filter by Age
			const remainingFiles: typeof files = [];
			for (const file of files) {
				if (now - file.time > maxAge) {
					await fs.unlink(file.path);
					this.logger.logDebug(`Deleted old log file (age): ${file.name}`);
				} else {
					remainingFiles.push(file);
				}
			}

			// 2. Filter by Count (keep newest)
			if (remainingFiles.length > retentionCount) {
				// Sort by time descending (newest first)
				remainingFiles.sort((a, b) => b.time - a.time);

				const filesToDelete = remainingFiles.slice(retentionCount);
				for (const file of filesToDelete) {
					await fs.unlink(file.path);
					this.logger.logDebug(`Deleted old log file (count limit): ${file.name}`);
				}
			}
		} catch {
			// Directory might not exist yet or access denied
		}
	}

	/**
	 * Consulta del buffer en memoria. Envoltorio fino a propósito: la redacción de
	 * secretos ya ocurrió AL ESCRIBIR (`ConsoleLogger`), así que acá no queda nada
	 * que sanear, sólo filtrar y paginar.
	 */
	queryBuffer(filter: LogQuery): LogPage {
		return logBuffer.query(filter);
	}

	/**
	 * Los logs son de la plataforma, no de una organización: en contexto de org no se
	 * sirven, aunque el token traiga el permiso. Espejo de `assertGlobalActor` de
	 * `PlanService`; el permiso en sí lo valida el decorador del endpoint.
	 */
	assertGlobalContext(ctx: Pick<EndpointCtx<never, unknown>, "user">): void {
		if (ctx.user?.orgId) throw new AuthError(403, "FORBIDDEN", "Los logs de la plataforma se consultan en contexto global");
	}
}
