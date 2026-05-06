import { IModule, IModuleConfig } from "../interfaces/modules/IModule.js";
import { BaseModule } from "../common/BaseModule.js";
import { Kernel } from "../kernel.js";
import { OnlyKernel } from "../utils/decorators/OnlyKernel.ts";

export type IUtility = IModule;

/**
 * Clase base abstracta para todas las Utilities.
 * Las utilities son módulos de lógica reutilizable (serializers, validators, transformers).
 */
export abstract class BaseUtility extends BaseModule implements IUtility {
	abstract readonly name: string;
	private kernelKey?: symbol;

	constructor(kernel: Kernel, config?: IModuleConfig) {
		super(kernel, config);
	}

	public readonly setKernelKey = (key: symbol): void => {
		if (this.kernelKey) {
			throw new Error("Kernel key ya está establecida");
		}
		this.kernelKey = key;
	};

	@OnlyKernel()
	public async start(_kernelKey: symbol): Promise<void> {
		this.logger.logInfo(`Iniciando Utility ${this.name}`);
	}

	@OnlyKernel()
	public async stop(_kernelKey: symbol): Promise<void> {
		this.logger.logInfo(`Deteniendo Utility ${this.name}`);
	}
}
