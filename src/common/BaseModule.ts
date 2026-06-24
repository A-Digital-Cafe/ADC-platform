import { IModule, IModuleConfig } from "../interfaces/modules/IModule.js";
import { ILogger } from "../interfaces/utils/ILogger.js";
import { Logger } from "../utils/logger/Logger.js";
import { Kernel } from "../kernel.js";
import { emitNotification } from "./utils/notifications/emit.js";
import type { NotifyInput } from "./types/notifications/Notification.js";

/**
 * Clase base abstracta para módulos que necesitan acceso al Kernel.
 * Proporciona métodos protegidos para obtener providers, services y utilities
 * de forma controlada (solo los declarados en la configuración del módulo).
 *
 * Extendida por: BaseApp, BaseService, BaseUtility
 * NO extendida por: BaseProvider (no necesita acceso al registry)
 */
export abstract class BaseModule implements IModule {
	abstract readonly name: string;

	protected readonly logger: ILogger = Logger.getLogger(this.constructor.name);
	protected config: IModuleConfig;
	readonly #kernel: Kernel;

	constructor(kernel: Kernel, config?: IModuleConfig) {
		this.#kernel = kernel;
		this.config = {
			name: "unknown",
			...config,
		};
	}

	/**
	 * Lógica de inicialización del módulo.
	 */
	public abstract start(_kernelKey: symbol): Promise<void>;

	/**
	 * Lógica de detención del módulo.
	 */
	public abstract stop(_kernelKey?: symbol): Promise<void>;

	/**
	 * Hook llamado por el orquestador cuando una dependencia (típicamente opcional)
	 * de este módulo vuelve a estar disponible tras un restart, mientras este módulo
	 * siguió corriendo. Permite re-conectar integraciones cuya instancia/estado se
	 * perdió (p.ej. re-registrar datos push-based como SEO). No-op por defecto.
	 */
	public onDependencyRestored(_dependencyName: string): void | Promise<void> {}

	/**
	 * Resuelve un item declarado en `config.providers/utilities/services`
	 * aceptando match exacto o por basename (último segmento de la ruta
	 * lógica, e.g. `"comments/comments-utility"` ↔ `"comments-utility"`).
	 */
	#findDeclared<T extends { name: string }>(items: T[] | undefined, name: string): T | undefined {
		if (!items?.length) return undefined;
		const exact = items.find((i) => i.name === name);
		if (exact) return exact;
		return items.find((i) => {
			const base = i.name.split("/").pop();
			return base === name;
		});
	}

	/**
	 * Obtiene un provider que fue cargado por este módulo según su configuración.
	 * Esto asegura que se obtiene la instancia correcta cuando hay múltiples providers del mismo tipo.
	 * @param name - Nombre del provider
	 * @param config - Configuración opcional para sobrescribir la búsqueda
	 * @returns La instancia del provider
	 */
	protected getMyProvider<P>(name: string, config?: IModuleConfig): P {
		const providerConfig = config || this.#findDeclared(this.config?.providers, name);
		if (!providerConfig) {
			throw new Error(`Provider ${name} no está configurado en ${this.name}`);
		}
		return this.#kernel.registry.getProvider<P>(name, providerConfig.custom);
	}

	/**
	 * Obtiene una utility que fue cargada por este módulo según su configuración.
	 * @param name - Nombre de la utility
	 * @param config - Configuración opcional para sobrescribir la búsqueda
	 * @returns La instancia de la utility
	 */
	protected getMyUtility<U>(name: string, config?: IModuleConfig): U {
		const utilityConfig = config || this.#findDeclared(this.config?.utilities, name);
		if (!utilityConfig) {
			throw new Error(`Utility ${name} no está configurada en ${this.name}`);
		}
		return this.#kernel.registry.getUtility<U>(name, utilityConfig.custom);
	}

	/**
	 * Obtiene un service que fue cargado por este módulo según su configuración.
	 * @param name - Nombre del service
	 * @param config - Configuración opcional para sobrescribir la búsqueda
	 * @returns La instancia del service
	 */
	protected getMyService<S>(name: string, config?: IModuleConfig): S {
		const serviceConfig = config || this.#findDeclared(this.config?.services, name);
		if (!serviceConfig) {
			throw new Error(`Service ${name} no está configurado en ${this.name}`);
		}
		return this.#kernel.registry.getService<S>(name, serviceConfig.custom);
	}

	/**
	 * Emite una notificación a un usuario de forma desacoplada y tolerante a fallos
	 * (cola durable RabbitMQ → entrega directa → best-effort). **Nunca lanza**: si el
	 * subsistema de notificaciones está caído o en mantenimiento, el módulo productor
	 * sigue funcionando y la notificación se entrega cuando el servicio vuelve.
	 *
	 * No requiere declarar `NotificationService` ni `queue/rabbitmq` como dependencia:
	 * resuelve lo que haya disponible en el kernel en tiempo de ejecución.
	 */
	protected async emitNotification(input: NotifyInput): Promise<void> {
		try {
			const ok = await emitNotification(this.#kernel, input);
			if (!ok) this.logger.logDebug(`Notificación descartada (subsistema no disponible): topic=${input.topic}`);
		} catch (e) {
			// Defensa extra: emitNotification ya es no-throw, pero nunca propagamos.
			this.logger.logWarn(`emitNotification falló (ignorado): ${(e as Error).message}`);
		}
	}
}
