import * as path from "node:path";
import * as fs from "node:fs/promises";
import { spawn, ChildProcess } from "node:child_process";
import { IModuleLoader } from "../../../interfaces/modules/IModuleLoader.js";
import { IModule, IModuleConfig } from "../../../interfaces/modules/IModule.js";
import { IProvider } from "../../../providers/BaseProvider.js";
import { IService } from "../../../services/BaseService.js";
import { IUtility } from "../../../utilities/BaseUtility.js";
import { Kernel } from "../../../kernel.js";
import { Logger } from "../../logger/Logger.js";
import { ipcManager } from "../../ipc/IPCManager.js";
import { ModuleType } from "../../registry/ModuleRegistry.ts";

interface CppModuleOptions {
	name: string;
	modulePath: string;
	version: string;
	role: ModuleType;
	type?: string;
	config?: Record<string, any>;
	process: ChildProcess;
}

/**
 * Crea un wrapper proxy para módulos C++ que:
 * - Expone propiedades del módulo (name, type, etc.)
 * - Delega métodos de lifecycle (start, stop) con verificación de kernelKey
 * - Delega cualquier otro método automáticamente via IPC
 */
function createCppModuleProxy(options: CppModuleOptions): IModule {
	let kernelKey: symbol | undefined;

	const wrapper = {
		name: options.name,
		modulePath: options.modulePath,
		version: options.version,
		role: options.role,
		type: options.type || options.config?.type || "default",

		setKernelKey: (key: symbol): void => {
			if (kernelKey) {
				throw new Error("Kernel key ya está establecida");
			}
			kernelKey = key;
		},

		start: async (key: symbol): Promise<void> => {
			verifyKernelKey(key, "start");
			Logger.info(`[CppModuleWrapper] Iniciando módulo C++: ${options.name}`);
		},

		stop: async (key: symbol): Promise<void> => {
			verifyKernelKey(key, "stop");
			if (options.process && !options.process.killed) {
				options.process.kill();
				Logger.info(`[CppModuleWrapper] Proceso C++ detenido: ${options.name}`);
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
				return await ipcManager.call(options.name, options.version, "C++", prop, args);
			};
		},
	});
}

/**
 * Loader para módulos C++.
 * Inicia procesos C++ y se comunica con ellos mediante IPC (named pipes).
 */
export default class CppLoader implements IModuleLoader {
	private readonly processes = new Map<string, ChildProcess>();
	private readonly modules = {
		provider: [] as IModule[],
		utility: [] as IModule[],
		service: [] as IModule[],
	};

	async canHandle(modulePath: string): Promise<boolean> {
		try {
			const indexFile = path.join(modulePath, "index.cpp");
			await fs.stat(indexFile);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Inicia un proceso C++ para el módulo y configura el servidor IPC
	 */
	private async startCppProcess(
		modulePath: string,
		moduleName: string,
		moduleVersion: string,
		moduleType: ModuleType,
		config?: Record<string, any>
	): Promise<ChildProcess> {
		const processKey = `${moduleName}-${moduleVersion}`;

		// Si ya existe un proceso para este módulo, reutilizarlo
		if (this.processes.has(processKey)) {
			return this.processes.get(processKey)!;
		}

		const indexFile = path.join(modulePath, "index.cpp");

		// Preparar el entorno y argumentos para el proceso C++
		// Determinar el path base según el entorno
		const basePath = process.env.NODE_ENV === "development" ? "src" : "dist";
		const cppPath = path.resolve(process.cwd(), basePath, "interfaces", "interop", "cpp");

		const env = {
			...process.env,
			ADC_MODULE_NAME: moduleName,
			ADC_MODULE_VERSION: moduleVersion,
			ADC_MODULE_TYPE: moduleType,
			ADC_MODULE_CONFIG: config ? JSON.stringify(config) : "{}",
			CPPPATH: cppPath,
		};

		Logger.debug(`[CppLoader] Iniciando proceso C++: ${indexFile}`);
		Logger.debug(`[CppLoader] CPPPATH: ${cppPath}`);

		const cmakeProcess = spawn("/usr/bin/cmake", [modulePath, "-B", `../../../../temp/builds/${moduleType}/${moduleName}`], {
			stdio: "pipe",
		});

		let cmakeOutput = "";
		let cmakeError = "";
		cmakeProcess.stdout?.on("data", (data: Buffer) => {
			cmakeOutput += data.toString();
		});
		cmakeProcess.stderr?.on("data", (data: Buffer) => {
			cmakeError += data.toString();
		});

		await new Promise<void>((resolve, reject) => {
			cmakeProcess.on("exit", (code) => {
				if (code !== 0) {
					Logger.error(`[CppLoader] CMake falló (código ${code}):`, cmakeError.trim());
					reject(new Error(`CMake falló con código ${code}`));
				} else {
					if (cmakeOutput.trim()) Logger.debug("[CppLoader] CMake:", cmakeOutput.trim());
					resolve();
				}
			});
		});

		const cppProcess = spawn(`../../../../temp/builds/${moduleType}/${moduleName}/index`, [], {
			env,
			stdio: ["pipe", "pipe", "pipe"],
		});

		// Helper para parsear y loguear mensajes con el nivel correcto
		const logCppMessage = (data: Buffer) => {
			const message = data.toString().trim();
			if (!message) return;

			// Intentar parsear el nivel de log del formato: [NIVEL] [módulo] mensaje
			const levelMatch = message.match(/^\[(DEBUG|INFO|OK|WARN|ERROR)\]\s+(.*)/i);

			if (levelMatch) {
				const level = levelMatch[1].toUpperCase();
				const rest = levelMatch[2];

				// Loguear con el nivel correcto
				switch (level) {
					case "DEBUG":
						Logger.debug(`[Cpp:${moduleName}] ${rest}`);
						break;
					case "INFO":
						Logger.info(`[Cpp:${moduleName}] ${rest}`);
						break;
					case "OK":
						Logger.ok(`[Cpp:${moduleName}] ${rest}`);
						break;
					case "WARN":
						Logger.warn(`[Cpp:${moduleName}] ${rest}`);
						break;
					case "ERROR":
						Logger.error(`[Cpp:${moduleName}] ${rest}`);
						break;
					default:
						Logger.info(`[Cpp:${moduleName}] ${message}`);
				}
			} else {
				// Si no hay nivel explícito, loguear como info
				Logger.info(`[Cpp:${moduleName}] ${message}`);
			}
		};

		// Capturar salida estándar y de errores (ambos van a stderr desde C++)
		cppProcess.stdout?.on("data", (data) => {
			logCppMessage(data);
		});

		cppProcess.stderr?.on("data", (data) => {
			logCppMessage(data);
		});

		// Manejar salida del proceso
		cppProcess.on("exit", (code) => {
			Logger.warn(`[CppLoader] Proceso C++ terminado: ${moduleName} (código: ${code})`);
			this.processes.delete(processKey);
			this.removeModuleReference(moduleName);
		});

		// Guardar el proceso
		this.processes.set(processKey, cppProcess);

		// Esperar un momento para que el proceso C++ inicie el servidor IPC
		await new Promise((resolve) => setTimeout(resolve, 1000));

		return cppProcess;
	}

	private removeModuleReference(name: string) {
		for (const role of ["provider", "utility", "service"] as ModuleType[]) {
			this.modules[role] = this.modules[role].filter((m) => m.name !== name);
		}
	}

	async loadProvider(modulePath: string, config?: Record<string, any>): Promise<IProvider> {
		try {
			const moduleName = config?.moduleName || path.basename(modulePath);
			const moduleVersion = config?.moduleVersion || "1.0.0";
			const moduleType = config?.type;

			Logger.debug(`[CppLoader] Cargando Provider C++: ${moduleName}@${moduleVersion}`);

			const cppProcess = await this.startCppProcess(modulePath, moduleName, moduleVersion, "provider", config);

			const proxy = createCppModuleProxy({
				name: moduleName,
				modulePath,
				version: moduleVersion,
				role: "provider",
				type: moduleType,
				config,
				process: cppProcess,
			});

			this.modules.provider.push(proxy);
			return proxy as IProvider;
		} catch (error) {
			Logger.error(`[CppLoader] Error cargando Provider: ${error}`);
			throw error;
		}
	}

	async loadUtility(modulePath: string, config?: Record<string, any>): Promise<IUtility> {
		try {
			const moduleName = config?.moduleName || path.basename(modulePath);
			const moduleVersion = config?.moduleVersion || "1.0.0";

			Logger.debug(`[CppLoader] Cargando Utility C++: ${moduleName}@${moduleVersion}`);

			const cppProcess = await this.startCppProcess(modulePath, moduleName, moduleVersion, "utility", config);

			const proxy = createCppModuleProxy({
				name: moduleName,
				modulePath,
				version: moduleVersion,
				role: "utility",
				config,
				process: cppProcess,
			});

			this.modules.utility.push(proxy);
			return proxy;
		} catch (error) {
			Logger.error(`[CppLoader] Error cargando Utility: ${error}`);
			throw error;
		}
	}

	async loadService(modulePath: string, _kernel: Kernel, config?: Record<string, any> | IModuleConfig): Promise<IService> {
		try {
			const moduleConfig = config as IModuleConfig;
			const moduleName = moduleConfig?.name || path.basename(modulePath);
			const moduleVersion = moduleConfig?.version || "1.0.0";

			Logger.debug(`[CppLoader] Cargando Service C++: ${moduleName}@${moduleVersion}`);

			const cppProcess = await this.startCppProcess(modulePath, moduleName, moduleVersion, "service", moduleConfig?.config);

			const proxy = createCppModuleProxy({
				name: moduleName,
				modulePath,
				version: moduleVersion,
				role: "service",
				config: moduleConfig?.config,
				process: cppProcess,
			});

			this.modules.service.push(proxy);
			return proxy;
		} catch (error) {
			Logger.error(`[CppLoader] Error cargando Service: ${error}`);
			throw error;
		}
	}

	/**
	 * Detiene todos los procesos C++
	 */
	async stopAll(): Promise<void> {
		for (const [key, process] of this.processes) {
			if (!process.killed) {
				process.kill();
				Logger.info(`[CppLoader] Proceso C++ detenido: ${key}`);
			}
		}
		this.processes.clear();
	}
}
