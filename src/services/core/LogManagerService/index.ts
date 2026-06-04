import * as fs from "node:fs/promises";
import * as path from "node:path";
import { BaseService } from "../../BaseService.js";
import { Kernel } from "../../../kernel.js";
import { ILogManagerService } from "./types.js";
import { ModuleTypes } from "../../../utils/registry/ModuleRegistry.js";
import { OnlyKernel } from "../../../utils/decorators/OnlyKernel.ts";

export default class LogManagerService extends BaseService implements ILogManagerService {
	public readonly name = "LogManagerService";
	private cleanupInterval: NodeJS.Timeout | null = null;

	constructor(kernel: Kernel, options?: any) {
		super(kernel, options);
	}

	@OnlyKernel()
	async start(kernelKey: symbol): Promise<void> {
		await super.start(kernelKey);

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
	 * Query logs for a specific app
	 */
	async queryLogs(title: string, moduleType: ModuleTypes, date?: string): Promise<string> {
		const logsDir = this.getLogsDir();
		const moduleLogDir = path.join(logsDir, moduleType, title);

		try {
			// Check if directory exists
			try {
				await fs.access(moduleLogDir);
			} catch {
				// Check for flat file
				const flatFile = path.join(logsDir, `${title}.log`);
				try {
					return await fs.readFile(flatFile, "utf-8");
				} catch {
					return `No logs found for ${title}`;
				}
			}

			// If directory, read files
			const files = await fs.readdir(moduleLogDir);
			let content = "";

			for (const file of files) {
				if (date && !file.includes(date)) continue;

				content += `--- Log File: ${file} ---\n`;
				content += await fs.readFile(path.join(moduleLogDir, file), "utf-8");
				content += "\n";
			}

			return content || "No matching logs found.";
		} catch (error: any) {
			return `Error querying logs: ${error.message}`;
		}
	}
}
