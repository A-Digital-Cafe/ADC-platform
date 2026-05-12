import { Logger } from "../logger/Logger.ts";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);
/**
 * Mata todos los procesos hijos del proceso actual
 */
export default async function killAllChildProcesses(): Promise<void> {
	const pid = process.pid;

	try {
		// En Windows, usar taskkill
		if (process.platform === "win32") {
			try {
				await execAsync(`taskkill /F /T /PID ${pid}`);
			} catch {
				// NOOP
			}
		} else {
			// En Linux/Unix, matar todos los procesos del grupo de procesos
			try {
				// Primero intentar con SIGTERM
				await execAsync(`pkill -TERM -P ${pid}`);
				Logger.info("Enviando SIGTERM a procesos hijos...");
				await new Promise((resolve) => setTimeout(resolve, 2000));
				// Luego forzar con SIGKILL
				await execAsync(`pkill -KILL -P ${pid}`);
				Logger.info("Enviando SIGKILL a procesos hijos restantes...");
				// Matar específicamente procesos de Stencil y Node workers
				await execAsync("pkill -9 -f 'stencil build --watch'");
				await execAsync("pkill -9 -f 'node_modules/@stencil/core/sys/node/worker.js'");
				Logger.info("Matando procesos de Stencil...");
			} catch {
				// NOOP
			}
		}
	} catch (error: any) {
		Logger.debug(`Error matando procesos hijos: ${error.message}`);
	}
}
