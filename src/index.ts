// src/index.ts
import { Kernel } from "./kernel.js";
import { Logger } from "./utils/logger/Logger.js";
import killAllChildProcesses from "./utils/system/KillChildProcesses.ts";

async function main() {
	const kernel = new Kernel();
	// Secreto de arranque: sólo este bootstrap puede iniciar/detener el kernel.
	// Nunca se entrega a los módulos (a diferencia de las capabilities).
	const bootToken = Symbol("kernel-boot");

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
			await kernel.stop(bootToken);
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

	// Errores HTTP típicos no fatales: una request individual no debe tirar todo el kernel.
	// En un servidor con millones de usuarios, perder el proceso por una conexión rota es inaceptable.
	const NON_FATAL_ERROR_CODES = new Set([
		"ERR_HTTP_HEADERS_SENT",
		"ERR_STREAM_DESTROYED",
		"ERR_STREAM_WRITE_AFTER_END",
		"ERR_STREAM_PREMATURE_CLOSE",
		"ERR_SOCKET_CLOSED",
		"ECONNRESET",
		"EPIPE",
		"ECANCELED",
	]);
	const NON_FATAL_MESSAGE_HINTS = ["writeHead", "headers after they are sent", "Request aborted", "premature close"];
	const isNonFatal = (reason: any): boolean => {
		if (!reason) return false;
		const code = String(reason.code ?? "");
		if (NON_FATAL_ERROR_CODES.has(code)) return true;
		const msg = String(reason.message ?? reason);
		return NON_FATAL_MESSAGE_HINTS.some((hint) => msg.includes(hint));
	};

	// Manejar excepciones no capturadas
	process.on("uncaughtException", async (error) => {
		if (isNonFatal(error)) {
			Logger.warn(`[non-fatal] Excepción no capturada ignorada: ${error.message}`);
			return;
		}
		Logger.error(`Excepción no capturada: ${error.message}`);
		if (!isShuttingDown) {
			await shutdownHandler("UNCAUGHT_EXCEPTION");
		}
	});

	process.on("unhandledRejection", (reason: any) => {
		// Política de producción: NUNCA tirar el kernel por una promesa rechazada
		// (en su mayoría son errores transitorios de I/O / conexiones rotas).
		if (isNonFatal(reason)) {
			Logger.warn(`[non-fatal] Promesa rechazada ignorada: ${reason?.message || reason}`);
			if (reason?.stack && process.env.DEBUG_NON_FATAL === "1") Logger.warn(reason.stack);
			return;
		}
		Logger.error(`Promesa rechazada no manejada: ${reason?.message || reason}`);
		if (reason?.stack) Logger.error(reason.stack);
		// No iniciamos shutdown: log + continue. El operador investigará el log.
	});

	// Ahora sí iniciar el kernel (las señales ya están registradas)
	await kernel.start(bootToken);

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
