import { IModule } from "../interfaces/modules/IModule.js";
import { ILogger } from "../interfaces/utils/ILogger.js";
import { OnlyKernel, bindKernelKey } from "../utils/decorators/OnlyKernel.ts";
import { Logger } from "../utils/logger/Logger.js";

export interface IProvider extends IModule {
	readonly type: string;
}
export abstract class BaseProvider implements IProvider {
	/** Nombre único del provider */
	abstract readonly name: string;
	abstract readonly type: string;
	protected readonly logger: ILogger = Logger.getLogger(this.constructor.name);

	public readonly setKernelKey = (key: symbol): void => {
		bindKernelKey(this, key);
	};

	@OnlyKernel()
	public async start(_kernelKey: symbol): Promise<void> {
		this.logger.logDebug(`Iniciando ${this.name}`);
	}

	@OnlyKernel()
	public async stop(_kernelKey: symbol): Promise<void> {
		this.logger.logDebug(`Deteniendo ${this.name}`);
	}
}

export enum ProviderType {
	HTTP_SERVER_PROVIDER = "http-server-provider",
	STORAGE_PROVIDER = "storage-provider",
	OBJECT_PROVIDER = "object-provider",
	QUEUE_PROVIDER = "queue-provider",
}
