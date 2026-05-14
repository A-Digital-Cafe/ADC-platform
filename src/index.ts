// src/index.ts
import { Kernel } from "./kernel.js";
import { Logger } from "./utils/logger/Logger.js";
import killAllChildProcesses from "./utils/system/KillChildProcesses.ts";

async function main() {
	const kernel = new Kernel();

	// --- Manejador de señales para cierre ordenado ---
	let isShuttingDown = false;
	let shutdownStartedAt = 0;

	const FORCE_EXIT_WINDOW_MS = 1200; // humano, no ruido de hijos

	const shutdownHandler = async (signal: string) => {
		const now = Date.now();

		// Segunda señal DURANTE shutdown
		if (isShuttingDown) {
			// Si llega muy rápido → es ruido de hijos
			if (now - shutdownStartedAt < FORCE_EXIT_WINDOW_MS) {
				Logger.warn(`Señal ${signal} ignorada (rebote de proceso hijo)`);
				return;
			}

			Logger.error(`Forzando salida inmediata (${signal})...`);
			await killAllChildProcesses();
			process.exit(1);
		}

		// Primer SIGINT real
		isShuttingDown = true;
		shutdownStartedAt = now;

		Logger.info(`\nSeñal ${signal} recibida. Iniciando cierre ordenado...`);

		const shutdownTimeout = setTimeout(async () => {
			Logger.error("Timeout en el cierre. Matando todos los procesos hijos...");
			await killAllChildProcesses();
			process.exit(1);
		}, 15000);

		try {
			Logger.info("Deteniendo el kernel...");
			await kernel.stop();
			Logger.ok("Kernel detenido correctamente.");

			Logger.info("Ejecutando limpieza forzosa final...");
			await killAllChildProcesses();

			clearTimeout(shutdownTimeout);
			Logger.ok("Cierre completado exitosamente.");
			process.exit(0);
		} catch (error: any) {
			Logger.error(`Error durante el cierre: ${error.message}`);
			await killAllChildProcesses();
			clearTimeout(shutdownTimeout);
			process.exit(1);
		}
	};

	// Capturar múltiples señales
	process.on("SIGINT", () => shutdownHandler("SIGINT")); // Ctrl+C
	process.on("SIGTERM", () => shutdownHandler("SIGTERM")); // kill
	process.on("SIGHUP", () => shutdownHandler("SIGHUP")); // Terminal cerrada
	process.on("SIGQUIT", () => shutdownHandler("SIGQUIT")); // Ctrl+\

	// Manejar excepciones no capturadas
	process.on("uncaughtException", async (error) => {
		Logger.error(`Excepción no capturada: ${error.message}`);
		if (!isShuttingDown) {
			await shutdownHandler("UNCAUGHT_EXCEPTION");
		}
	});

	process.on("unhandledRejection", async (reason: any) => {
		Logger.error(`Promesa rechazada no manejada: ${reason?.message || reason}`);
		if (!isShuttingDown) {
			await shutdownHandler("UNHANDLED_REJECTION");
		}
	});

	// Ahora sí iniciar el kernel (las señales ya están registradas)
	await kernel.start();

	Logger.ok("---------------------------------------");
	Logger.ok("Kernel en funcionamiento.");
	Logger.info("Puedes agregar/quitar carpetas en /apps para ver la carga dinámica.");
	Logger.info("Presiona Ctrl+C para salir.");
	Logger.ok("---------------------------------------");
}

try {
	await main();
} catch (err) {
	console.error(err);
}
