import * as path from "node:path";
import * as fs from "node:fs/promises";
import { spawn, ChildProcess } from "node:child_process";
import { IModuleLoader } from "../../../interfaces/modules/IModuleLoader.js";
import { IModule, IModuleConfig } from "../../../interfaces/modules/IModule.js";

import { Kernel } from "../../../kernel.js";
import { Logger } from "../../logger/Logger.js";
import { ipcManager } from "../../ipc/IPCManager.js";
import type { IUtility } from "../../../utilities/BaseUtility.ts";
import type { IService } from "../../../services/BaseService.ts";
import { ModuleType } from "../../registry/ModuleRegistry.ts";

interface PythonModuleOptions {
	name: string;
	modulePath: string;
	version: string;
	role: ModuleType;
	config?: Record<string, any>;
	process: ChildProcess;
}

/**
 * Crea un wrapper proxy para módulos Python que:
 * - Expone propiedades del módulo (name, type, etc.)
 * - Delega métodos de lifecycle (start, stop) con verificación de kernelKey
 * - Delega cualquier otro método automáticamente via IPC
 */
function createPythonModuleProxy(options: PythonModuleOptions): IModule {
	let kernelKey: symbol | undefined;

	const wrapper = {
		name: options.name,
		modulePath: options.modulePath,
		version: options.version,
		role: options.role,
		type: options.config?.type || "default",

		setKernelKey: (key: symbol): void => {
			if (kernelKey) {
				throw new Error("Kernel key ya está establecida");
			}
			kernelKey = key;
		},

		start: async (key: symbol): Promise<void> => {
			verifyKernelKey(key, "start");
			Logger.info(`[PythonModuleWrapper] Solicitando inicio remoto (start) a: ${options.name}`);
			await ipcManager.call(options.name, options.version, "python", "on_start", []);
		},

		stop: async (key: symbol): Promise<void> => {
			verifyKernelKey(key, "stop");
			if (options.process && !options.process.killed) {
				options.process.kill();
				Logger.info(`[PythonModuleWrapper] Proceso detenido: ${options.name} (${options.role})`);
			}
		},
	};

	function verifyKernelKey(keyToVerify: symbol, methodName: string): void {
		if (!kernelKey) {
			throw new Error("Kernel key no establecida");
		}
		if (kernelKey !== keyToVerify) {
			throw new Error(`Acceso no autorizado a ${methodName}`);
		}
	}

	// Propiedades conocidas del wrapper que NO deben delegarse a IPC
	const knownProps = new Set(["name", "modulePath", "version", "role", "type", "setKernelKey", "start", "stop"]);

	return new Proxy(wrapper, {
		get(target, prop) {
			// Propiedades conocidas: devolver del wrapper
			if (typeof prop === "string" && knownProps.has(prop)) {
				return target[prop as keyof typeof target];
			}

			// Ignorar símbolos y propiedades de Promise
			if (typeof prop === "symbol" || ["then", "catch", "finally", "toJSON"].includes(prop)) {
				return undefined;
			}

			// Cualquier otro método: delegar a IPC
			return async (...args: any[]) => {
				return await ipcManager.call(options.name, options.version, "python", prop, args);
			};
		},
	});
}

/**
 * Loader optimizado con gestión de ciclo de vida ordenado.
 */
export default class PythonLoader implements IModuleLoader {
	// Almacenamos los wrappers clasificados para poder detenerlos en orden
	private modules = {
		provider: [] as IModule[],
		utility: [] as IModule[],
		service: [] as IModule[],
	};

	async canHandle(modulePath: string): Promise<boolean> {
		try {
			await fs.stat(path.join(modulePath, "index.py"));
			return true;
		} catch {
			return false;
		}
	}

	async loadProvider(modulePath: string, config?: Record<string, any>): Promise<IModule> {
		return this.loadModule(modulePath, "provider", config);
	}

	async loadUtility(modulePath: string, config?: Record<string, any>): Promise<IUtility> {
		return this.loadModule(modulePath, "utility", config);
	}

	// Normalizamos la config si viene de IModuleConfig
	async loadService(modulePath: string, _kernel: Kernel, config?: IModuleConfig): Promise<IService> {
		const actualConfig = config?.config || (config as Record<string, any>);
		const wrapper = await this.loadModule(modulePath, "service", actualConfig, config);
		return wrapper;
	}

	/**
	 * Método centralizado para cargar cualquier tipo de módulo
	 */
	private async loadModule(
		modulePath: string,
		role: ModuleType,
		config?: Record<string, any>,
		rawModuleConfig?: IModuleConfig
	): Promise<IModule> {
		const name = rawModuleConfig?.name || config?.moduleName || path.basename(modulePath);
		const version = rawModuleConfig?.version || config?.moduleVersion || "1.0.0";

		Logger.debug(`[PythonLoader] Cargando ${role}: ${name}@${version}`);

		const pythonProcess = await this.startPythonProcess(modulePath, name, version, role, config);

		const proxy = createPythonModuleProxy({
			name,
			modulePath,
			version,
			role,
			config,
			process: pythonProcess,
		});

		// Guardamos la referencia en la lista correspondiente
		this.modules[role].push(proxy);

		return proxy;
	}

	private async startPythonProcess(
		modulePath: string,
		moduleName: string,
		moduleVersion: string,
		moduleType: string,
		config?: Record<string, any>
	): Promise<ChildProcess> {
		const indexFile = path.join(modulePath, "index.py");
		const basePath = process.env.NODE_ENV === "development" ? "src" : "dist";
		const pythonPath = path.resolve(process.cwd(), basePath, "interfaces", "interop", "py");

		const env = {
			...process.env,
			ADC_MODULE_NAME: moduleName,
			ADC_MODULE_VERSION: moduleVersion,
			ADC_MODULE_TYPE: moduleType,
			ADC_MODULE_CONFIG: JSON.stringify(config || {}),
			PYTHONPATH: pythonPath,
		};

		const pythonProcess = spawn("/usr/bin/python3", [indexFile], {
			env,
			stdio: ["pipe", "pipe", "pipe"],
		});

		this.setupProcessLogging(pythonProcess, moduleName);

		// Manejo de salida inesperada
		pythonProcess.on("exit", (code) => {
			if (code !== 0 && code !== null) {
				Logger.warn(`[PythonLoader] Proceso ${moduleName} terminó inesperadamente (código: ${code})`);
			}
			this.removeWrapperReference(moduleName);
		});

		// Esperar inicialización del IPC
		await new Promise((resolve) => setTimeout(resolve, 1000));

		return pythonProcess;
	}

	private setupProcessLogging(process: ChildProcess, moduleName: string) {
		const logHandler = (data: Buffer) => {
			const msg = data.toString().trim();
			if (!msg) return;

			const match = msg.match(/^\[(DEBUG|INFO|OK|WARN|ERROR)\]\s+(.*)/i);
			if (match) {
				const levelStr = match[1].toUpperCase();
				const content = `[Py:${moduleName}] ${match[2]}`;

				// Mapeo seguro de strings a métodos de Logger
				switch (levelStr) {
					case "DEBUG":
						Logger.debug(content);
						break;
					case "INFO":
						Logger.info(content);
						break;
					case "OK":
						Logger.ok(content);
						break;
					case "WARN":
						Logger.warn(content);
						break;
					case "ERROR":
						Logger.error(content);
						break;
					default:
						Logger.info(content);
				}
			} else {
				Logger.info(`[Py:${moduleName}] ${msg}`);
			}
		};

		process.stdout?.on("data", logHandler);
		process.stderr?.on("data", logHandler);
	}

	// Limpieza de referencias si el proceso muere solo
	private removeWrapperReference(name: string) {
		for (const role of ["provider", "utility", "service"] as ModuleType[]) {
			this.modules[role] = this.modules[role].filter((m) => m.name !== name);
		}
	}

	// Detiene los procesos en orden
	async stopAll(): Promise<void> {
		Logger.info("[PythonLoader] Iniciando secuencia de apagado ordenada...");

		const stopGroup = async (wrappers: IModule[], groupName: string) => {
			if (wrappers.length === 0) return;
			Logger.debug(`[PythonLoader] Deteniendo ${groupName} (${wrappers.length})...`);
			await Promise.all(wrappers.map((w) => (w as any).stop()));
			wrappers.length = 0;
		};

		await stopGroup(this.modules.provider, "Providers");
		await stopGroup(this.modules.utility, "Utilities");
		await stopGroup(this.modules.service, "Services");

		Logger.ok("[PythonLoader] Todos los procesos Python han sido detenidos.");
	}
}
