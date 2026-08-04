import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ChildProcess } from "node:child_process";

/** Techo duro: pasado esto se sigue igual (el watcher puede terminar más tarde). */
const READY_TIMEOUT_MS = 20_000;
const HTTP_POLL_INTERVAL_MS = 200;
const HTTP_TIMEOUT_MS = 1500;
const FILE_POLL_INTERVAL_MS = 250;
const OUTPUT_ENTRY = "main.js";

export type ReadyArm = "stdout" | "port" | "output" | "exit" | "timeout";

export interface ReadinessOptions {
	watcher: ChildProcess;
	/** Puerto del dev server, si lo hay (la rama `build --watch` no tiene). */
	devPort?: number;
	outputPath: string;
	/** Instante del spawn: los brazos de disco exigen artefactos posteriores a él. */
	spawnedAt: number;
}

/**
 * Espera a que un watcher de rspack esté realmente listo, en vez de dormir 5 s a ciegas.
 *
 * Corren cuatro brazos en carrera; gana el primero y el resto se descarta:
 *
 *  - **stdout**: `compiled successfully` / `built in …`. El listener se **teea** sobre el
 *    handler de logs existente (no lo reemplaza), así que el archivo de log sigue completo.
 *  - **port**: GET al bundle de entrada del dev server responde 200 (ver el porqué abajo).
 *  - **output**: `main.js` en el output con `mtime` posterior al spawn.
 *  - **exit**: el proceso murió con código distinto de 0 → no hay nada que esperar.
 *
 * Devuelve qué brazo ganó para poder medir dónde se va el tiempo por app.
 */
export function waitForRspackReady(opts: ReadinessOptions): Promise<ReadyArm> {
	const { watcher, devPort, outputPath, spawnedAt } = opts;
	const cleanups: (() => void)[] = [];
	let settled = false;

	return new Promise<ReadyArm>((resolve) => {
		const finish = (arm: ReadyArm) => {
			if (settled) return;
			settled = true;
			for (const cleanup of cleanups) cleanup();
			resolve(arm);
		};

		// 1) stdout — teeado sobre los handlers ya registrados.
		const onData = (data: Buffer | string) => {
			if (/compiled successfully|built in /i.test(data.toString())) finish("stdout");
		};
		watcher.stdout?.on("data", onData);
		cleanups.push(() => watcher.stdout?.off("data", onData));

		// 2) exit no-cero — el fallo es terminal, no tiene sentido seguir esperando.
		const onExit = (code: number | null) => {
			if (code !== 0) finish("exit");
		};
		watcher.on("exit", onExit);
		cleanups.push(() => watcher.off("exit", onExit));

		// 3) el dev server sirviendo el bundle de entrada.
		//
		// Es un GET a `/main.js` y no un `net.connect`: `rspack serve` **acepta conexiones
		// antes de compilar**, así que un socket abierto no dice nada (medido: ganaba la
		// carrera en ~200 ms con el bundle todavía sin generar). El middleware, en cambio,
		// retiene los pedidos de assets hasta que el primer compile termina, así que un 200
		// sí es señal de "compilado".
		if (devPort) {
			const httpTimer = setInterval(() => {
				fetch(`http://127.0.0.1:${devPort}/${OUTPUT_ENTRY}`, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) })
					.then((res) => {
						if (res.ok) finish("port");
					})
					.catch(() => {});
			}, HTTP_POLL_INTERVAL_MS);
			cleanups.push(() => clearInterval(httpTimer));
		}

		// 4) artefacto en disco más nuevo que el spawn.
		const entryPath = path.join(outputPath, OUTPUT_ENTRY);
		const fileTimer = setInterval(() => {
			fs.stat(entryPath)
				.then((stat) => {
					if (stat.mtimeMs >= spawnedAt) finish("output");
				})
				.catch(() => {});
		}, FILE_POLL_INTERVAL_MS);
		cleanups.push(() => clearInterval(fileTimer));

		const timeout = setTimeout(() => finish("timeout"), READY_TIMEOUT_MS);
		cleanups.push(() => clearTimeout(timeout));
	});
}
