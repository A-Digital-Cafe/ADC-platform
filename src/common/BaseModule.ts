import { IModule, IModuleConfig } from "../interfaces/modules/IModule.js";
import { ILogger } from "../interfaces/utils/ILogger.js";
import { Logger } from "../utils/logger/Logger.js";
import { Kernel } from "../kernel.js";
import { bindKernelKey } from "../utils/decorators/OnlyKernel.ts";
import type { ReadonlyModuleRegistry } from "../utils/registry/ReadonlyModuleRegistry.ts";
import type { ModuleRegistry } from "../utils/registry/ModuleRegistry.ts";
import type { ModuleLoader } from "../utils/loaders/ModuleLoader.ts";
import type { Capability } from "./security/Capability.ts";
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

	/**
	 * Handle **sólo‑lectura** del registry. Se captura en el constructor (no en
	 * `setKernelKey`) porque algunos módulos resuelven dependencias en su propio
	 * constructor, antes de recibir su token.
	 *
	 * Opcional: las **utilities** se construyen con `(config)` en vez de `(kernel)`
	 * (ver `TypeScriptLoader.loadUtility`) y no usan el registry —reciben sus
	 * dependencias por argumentos—, así que ahí queda `undefined`.
	 */
	readonly #readonlyRegistry?: ReadonlyModuleRegistry;

	/** Referencia al kernel real (sólo si el módulo se construyó con uno; ver nota arriba). */
	readonly #kernelRef?: Kernel;

	/** Capability de negocio del módulo (scopes acotados), para reenviar a superficies privilegiadas. */
	#businessCap?: Capability;

	/**
	 * Capability de infraestructura (registrar/cargar sub‑dependencias). **Contenida**:
	 * vive en este campo privado de BaseModule, inaccesible para las subclases y para
	 * código inyectado (que no tiene `this`), y sólo la usan `getMutableRegistry`/
	 * `getModuleLoader` de aquí.
	 */
	#infraCap?: Capability | symbol;

	constructor(kernel: Kernel, config?: IModuleConfig) {
		// Las utilities se construyen con `(config)` en vez de `(kernel)`: sólo guardamos
		// la referencia/handles si realmente recibimos un Kernel.
		const maybeKernel = typeof (kernel as Kernel | undefined)?.getReadonlyRegistry === "function" ? kernel : undefined;
		this.#kernelRef = maybeKernel;
		this.#readonlyRegistry = maybeKernel?.getReadonlyRegistry();
		this.config = {
			name: "unknown",
			...config,
		};
	}

	/**
	 * Recibe el token de autorización del kernel (kernelKey o, tras la migración, la
	 * capability del módulo) y lo asocia a la instancia para que `@OnlyKernel` lo valide
	 * sin que sea legible como propiedad por nombre.
	 *
	 * Único para Apps/Services/Utilities (todas extienden BaseModule). Providers tienen
	 * el suyo propio (no acceden al registry).
	 */
	public readonly setKernelKey = (token: symbol): void => {
		bindKernelKey(this, token);
	};

	/** El kernel (`provisionModule`) inyecta la businessCap del módulo. Idempotente. */
	public setCapability(cap: Capability): void {
		if (this.#businessCap) throw new Error("Capability ya establecida");
		this.#businessCap = cap;
	}

	/** El kernel (`provisionModule`) inyecta la infraCap. Idempotente. */
	public setInfraToken(token: Capability | symbol): void {
		if (this.#infraCap) throw new Error("Infra capability ya establecida");
		this.#infraCap = token;
	}

	/**
	 * Handle sólo‑lectura del registry para uso **interno** de BaseModule. NO se expone
	 * a las subclases: la lógica de negocio sólo resuelve dependencias **declaradas** en
	 * `config.json` vía `getMyService`/`getMyProvider`/`getMyUtility`.
	 */
	#requireRegistry(): ReadonlyModuleRegistry {
		if (!this.#readonlyRegistry) {
			throw new Error(`Registry no disponible en ${this.name} (módulo construido sin Kernel)`);
		}
		return this.#readonlyRegistry;
	}

	/**
	 * Resuelve un service de **plataforma** por nombre fijo (infra de clase base; hoy
	 * sólo `UIFederationService`, para que `BaseApp` registre su módulo UI). NO es para
	 * resolver dependencias de negocio (usá `getMyService`); sus métodos privilegiados
	 * siguen gateados por scope.
	 */
	protected getUiFederationService<S>(): S {
		return this.#requireRegistry().getService<S>("UIFederationService");
	}

	/**
	 * businessCap del módulo, para **reenviar** a superficies que validan scope
	 * (p.ej. `identity._internal(cap)`). Acotada por la política de su tier.
	 */
	protected getCapability(): Capability {
		if (!this.#businessCap) throw new Error(`Capability no disponible en ${this.name} (módulo no provisionado)`);
		return this.#businessCap;
	}

	/**
	 * Registry **mutable** para registrar las sub‑dependencias declaradas del módulo.
	 * Usa la infraCap contenida; la subclase puede invocarlo pero no extraer la infraCap.
	 */
	protected getMutableRegistry(): ModuleRegistry {
		if (!this.#kernelRef || !this.#infraCap) throw new Error(`Infra no disponible en ${this.name} (módulo no provisionado)`);
		return this.#kernelRef.getMutableRegistry(this.#infraCap);
	}

	/** Loader para cargar las sub‑dependencias declaradas del módulo. Usa la infraCap contenida. */
	protected getModuleLoader(): ModuleLoader {
		if (!this.#infraCap) throw new Error(`Infra no disponible en ${this.name} (módulo no provisionado)`);
		return Kernel.getModuleLoader(this.#infraCap);
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
		return this.#requireRegistry().getProvider<P>(name, providerConfig.custom);
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
		return this.#requireRegistry().getUtility<U>(name, utilityConfig.custom);
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
		return this.#requireRegistry().getService<S>(name, serviceConfig.custom);
	}

	/**
	 * Igual que {@link getMyService} pero **tolerante**: devuelve `undefined` si el service
	 * declarado aún no está cargado (o no está declarado). Para dependencias **opcionales**
	 * declaradas en `config.json` (p.ej. integraciones que pueden no estar presentes).
	 */
	protected tryGetMyService<S>(name: string, config?: IModuleConfig): S | undefined {
		try {
			return this.getMyService<S>(name, config);
		} catch {
			return undefined;
		}
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
			const ok = await emitNotification(this.#requireRegistry(), input);
			if (!ok) this.logger.logDebug(`Notificación descartada (subsistema no disponible): topic=${input.topic}`);
		} catch (e) {
			// Defensa extra: emitNotification ya es no-throw, pero nunca propagamos.
			this.logger.logWarn(`emitNotification falló (ignorado): ${(e as Error).message}`);
		}
	}
}
