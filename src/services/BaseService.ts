import * as path from "node:path";
import { IModule, IModuleConfig } from "../interfaces/modules/IModule.js";
import { Kernel } from "../kernel.js";
import { ILifecycle } from "../interfaces/behaviours/ILifecycle.js";
import { OnlyKernel } from "../utils/decorators/OnlyKernel.ts";
import { BaseModule } from "../common/BaseModule.js";

export interface IService extends IModule, ILifecycle {}

/**
 * Clase base abstracta para todos los Services.
 * Maneja la inyección del Kernel y la carga de módulos desde config.json.
 */
export abstract class BaseService extends BaseModule implements IService {
	private isInitialized = false; // Flag para prevenir múltiples inicializaciones
	/** Nombre único del service */
	abstract readonly name: string;

	constructor(
		kernel: Kernel,
		protected readonly options?: IModuleConfig
	) {
		super(kernel, options);
	}

	/**
	 * Lógica de inicialización del service
	 */
	@OnlyKernel()
	public async start(_kernelKey: symbol): Promise<void> {
		// Prevenir múltiples inicializaciones
		if (this.isInitialized) {
			this.logger.logDebug(`${this.name} ya está inicializado, saltando start()`);
			return;
		}

		// Si ModuleLoader pasó el path real, usarlo; si no, calcular manualmente
		const serviceDir = this.options?.__modulePath || this.getServiceDir();

		this.logger.logInfo(`Inicializando ${this.name}...`);

		try {
			// Carga de sub‑dependencias declaradas. El registry mutable y el ModuleLoader no
			// salen de BaseModule: acá sólo llega la config resultante.
			const baseConfig = await this.bootstrapDeclaredDeps(serviceDir, this.options);

			this.config = {
				name: this.name,
				...baseConfig,
				...this.options, // options tiene prioridad
				providers: baseConfig.providers,
				utilities: baseConfig.utilities,
				services: this.options?.services || baseConfig.services || [],
			};

			// Marcar como inicializado
			this.isInitialized = true;

			this.logger.logOk(`Inicialización base completada`);
		} catch (error) {
			this.logger.logError(`Error durante inicialización: ${error}`);
			throw error;
		}
	}

	/**
	 * Lógica de cierre del service
	 */
	@OnlyKernel()
	public async stop(_kernelKey: symbol): Promise<void> {
		this.logger.logDebug(`Deteniendo servicio ${this.name}`);
	}

	/**
	 * Espera a que un provider termine de conectar, con timeout duro.
	 *
	 * Un provider de infraestructura (mongo, redis) puede tardar en levantar: fallar
	 * al primer intento haría depender el arranque del orden de los contenedores.
	 *
	 * Si el provider expone `whenReady()` se espera su promesa de conexión (despierta en
	 * cuanto conecta y propaga el error real); el poll queda sólo para los que no la tienen.
	 */
	protected async waitForProvider(
		provider: { isConnected(): boolean; whenReady?(): Promise<void> },
		what = "El provider",
		maxWaitMs = 10_000
	): Promise<void> {
		if (provider.isConnected()) return;
		let cause: unknown;
		if (provider.whenReady) {
			let timer: NodeJS.Timeout | undefined;
			try {
				await Promise.race([
					provider.whenReady(),
					new Promise((_, reject) => {
						timer = setTimeout(() => reject(new Error(`timeout de ${maxWaitMs} ms`)), maxWaitMs);
					}),
				]);
			} catch (error) {
				cause = error;
			} finally {
				clearTimeout(timer);
			}
		} else {
			const startTime = Date.now();
			while (!provider.isConnected() && Date.now() - startTime < maxWaitMs) {
				await new Promise((resolve) => setTimeout(resolve, 500));
			}
		}
		if (!provider.isConnected()) throw new Error(`${what} no pudo conectarse en el tiempo esperado`, { cause });
	}

	/**
	 * Resuelve el directorio del service según el entorno
	 */
	protected getServiceDir(): string {
		const isDevelopment = process.env.NODE_ENV === "development";
		const serviceName = this.constructor.name
			.replace(/Service$/, "")
			.replaceAll(/([A-Z])/g, "-$1")
			.toLowerCase()
			.replace(/^-/, "");

		const serviceDir = isDevelopment
			? path.resolve(process.cwd(), "src", "services", serviceName)
			: path.resolve(process.cwd(), "dist", "services", serviceName);

		return serviceDir;
	}
}
