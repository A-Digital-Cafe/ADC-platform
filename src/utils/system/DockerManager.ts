import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { Logger } from "../logger/Logger.ts";
import { ILogger } from "../../interfaces/utils/ILogger.js";
import os from "node:os";

/**
 * Gestiona las operaciones de Docker Compose para apps, servicios y contenedores comunes del Kernel.
 */
export class DockerManager {
	readonly #logger: ILogger = Logger.getLogger("DockerManager");
	readonly #dockerPath: string;
	readonly #appDockerComposeMap = new Map<string, string>();
	readonly #serviceDockerComposeMap = new Map<string, string>();
	readonly #commonDockerComposeMap = new Map<string, string>();

	constructor() {
		try {
			this.#dockerPath =
				os.platform() === "win32"
					? "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe"
					: execFileSync("/usr/bin/which", ["docker"]).toString().trim();
		} catch (error) {
			this.#logger.logError(`Failed to locate Docker binary: ${error}`);
			throw new Error("Docker binary not found. Ensure Docker is installed and available in PATH.", { cause: error });
		}
	}

	/**
	 * Ejecuta docker-compose up -d en el directorio especificado.
	 */
	async runDockerCompose(dir: string, name: string, type: "app" | "service" | "common"): Promise<void> {
		const dockerComposeFile = path.join(dir, "docker-compose.yml");
		await fs.stat(dockerComposeFile);

		this.#logger.logInfo(`Iniciando servicios Docker para ${name}...`);

		const { spawn } = await import("node:child_process");
		const docker = spawn(this.#dockerPath, ["compose", "-f", dockerComposeFile, "up", "-d"], {
			cwd: dir,
			stdio: "pipe",
		});

		return new Promise((resolve, reject) => {
			let output = "";
			docker.stdout?.on("data", (data) => {
				output += data.toString();
			});
			docker.stderr?.on("data", (data) => {
				output += data.toString();
			});
			docker.on("close", (code) => {
				if (code === 0) {
					this.#logger.logOk(`Servicios Docker iniciados para ${name}`);
					const map =
						type === "app"
							? this.#appDockerComposeMap
							: type === "service"
								? this.#serviceDockerComposeMap
								: this.#commonDockerComposeMap;
					map.set(name, dir);
					setTimeout(() => resolve(), 3000);
				} else {
					this.#logger.logWarn(`docker-compose falló con código ${code}`);
					if (output.trim()) {
						this.#logger.logWarn(`Output: ${output.trim()}`);
					}
					reject(new Error(`docker-compose exit code: ${code}`));
				}
			});
		});
	}

	/**
	 * Inicia docker-compose para una app específica.
	 */
	async startDockerCompose(appDir: string, appName: string): Promise<void> {
		try {
			await this.runDockerCompose(appDir, appName, "app");
		} catch (error: any) {
			if (error.code !== "ENOENT") {
				this.#logger.logWarn(`No se pudo ejecutar docker-compose: ${error.message}`);
			}
		}
	}

	/**
	 * Inicia docker-compose para un servicio kernel específico.
	 */
	async startServiceDockerCompose(serviceDir: string, serviceName: string): Promise<void> {
		try {
			await this.runDockerCompose(serviceDir, serviceName, "service");
		} catch (error: any) {
			if (error.code !== "ENOENT") {
				this.#logger.logDebug(`docker-compose no disponible para ${serviceName}`);
			}
		}
	}

	/**
	 * Detiene docker-compose en el directorio especificado.
	 */
	async stopDockerCompose(appDir: string): Promise<void> {
		const dockerComposeFile = path.join(appDir, "docker-compose.yml");
		try {
			await fs.stat(dockerComposeFile);

			this.#logger.logInfo(`Deteniendo servicios Docker para app en ${appDir}...`);

			const { spawn } = await import("node:child_process");
			const docker = spawn(this.#dockerPath, ["compose", "-f", dockerComposeFile, "down"], {
				cwd: appDir,
				stdio: "pipe",
			});

			return new Promise((resolve, reject) => {
				let output = "";
				docker.stdout?.on("data", (data) => {
					output += data.toString();
				});
				docker.stderr?.on("data", (data) => {
					output += data.toString();
				});
				docker.on("close", (code) => {
					if (code === 0) {
						this.#logger.logOk("Servicios Docker detenidos");
						resolve();
					} else {
						this.#logger.logWarn(`docker-compose down falló con código ${code}`);
						reject(new Error(`docker-compose exit code: ${code}`));
					}
				});
			});
		} catch (error: any) {
			if (error.code !== "ENOENT") {
				this.#logger.logWarn(`No se pudo detener docker-compose: ${error.message}`);
			}
		}
	}

	/**
	 * Verifica si una app tiene docker-compose configurado.
	 */
	hasAppDockerCompose(appBaseName: string): boolean {
		return this.#appDockerComposeMap.has(appBaseName);
	}

	/**
	 * Obtiene el directorio de docker-compose de una app.
	 */
	getAppDockerComposeDir(appBaseName: string): string | undefined {
		return this.#appDockerComposeMap.get(appBaseName);
	}

	/**
	 * Elimina el registro de docker-compose de una app.
	 */
	deleteAppDockerCompose(appBaseName: string): void {
		this.#appDockerComposeMap.delete(appBaseName);
	}

	/**
	 * Verifica si un servicio tiene docker-compose configurado.
	 */
	hasServiceDockerCompose(serviceName: string): boolean {
		return this.#serviceDockerComposeMap.has(serviceName);
	}

	/**
	 * Obtiene el directorio de docker-compose de un servicio.
	 */
	getServiceDockerComposeDir(serviceName: string): string | undefined {
		return this.#serviceDockerComposeMap.get(serviceName);
	}

	/**
	 * Elimina el registro de docker-compose de un servicio.
	 */
	deleteServiceDockerCompose(serviceName: string): void {
		this.#serviceDockerComposeMap.delete(serviceName);
	}

	/**
	 * Carga y ejecuta todos los docker-compose comunes desde un directorio.
	 * Lee las subcarpetas y ejecuta docker-compose.yml en cada una.
	 */
	async loadCommonDockerCompose(dockerDir: string): Promise<void> {
		try {
			const entries = await fs.readdir(dockerDir, { withFileTypes: true });
			const folders = entries.filter((e) => e.isDirectory());

			if (folders.length === 0) {
				this.#logger.logDebug("No hay contenedores comunes para cargar");
				return;
			}

			this.#logger.logInfo(`Cargando ${folders.length} contenedor(es) común(es)...`);

			for (const folder of folders) {
				const folderPath = path.join(dockerDir, folder.name);
				const composePath = path.join(folderPath, "docker-compose.yml");

				try {
					await fs.stat(composePath);
					await this.runDockerCompose(folderPath, folder.name, "common");
				} catch (error: any) {
					if (error.code === "ENOENT") {
						this.#logger.logDebug(`No hay docker-compose.yml en ${folder.name}`);
					} else {
						this.#logger.logWarn(`Error cargando contenedor común ${folder.name}: ${error.message}`);
					}
				}
			}
		} catch (error: any) {
			if (error.code === "ENOENT") {
				this.#logger.logDebug(`Directorio de docker común no existe: ${dockerDir}`);
			} else {
				this.#logger.logWarn(`Error leyendo directorio docker común: ${error.message}`);
			}
		}
	}

	/**
	 * Detiene todos los contenedores comunes.
	 */
	async stopAllCommonDockerCompose(): Promise<void> {
		for (const [name, dir] of this.#commonDockerComposeMap) {
			try {
				await this.stopDockerCompose(dir);
				this.#commonDockerComposeMap.delete(name);
			} catch (error: any) {
				this.#logger.logWarn(`Error deteniendo contenedor común ${name}: ${error.message}`);
			}
		}
	}

	/**
	 * Verifica si un contenedor común tiene docker-compose configurado.
	 */
	hasCommonDockerCompose(name: string): boolean {
		return this.#commonDockerComposeMap.has(name);
	}

	/**
	 * Obtiene el directorio de docker-compose de un contenedor común.
	 */
	getCommonDockerComposeDir(name: string): string | undefined {
		return this.#commonDockerComposeMap.get(name);
	}
}
