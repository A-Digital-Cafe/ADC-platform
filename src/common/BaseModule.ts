import * as fs from "node:fs/promises";
import * as path from "node:path";
import { IModule, IModuleConfig } from "../interfaces/modules/IModule.js";
import { ILogger } from "../interfaces/utils/ILogger.js";
import { Logger } from "../utils/logger/Logger.js";
import { Kernel } from "../kernel.js";
import { bindKernelKey } from "../utils/decorators/OnlyKernel.ts";
import type { ReadonlyModuleRegistry } from "../utils/registry/ReadonlyModuleRegistry.ts";
import { moduleKeyConfig, type ModuleRegistry } from "../utils/registry/ModuleRegistry.ts";
import type { ModuleLoader } from "../utils/loaders/ModuleLoader.ts";
import { safeParseJson } from "./utils/json-schema.ts";
import { moduleConfigCheck } from "./schemas/module-config.ts";
import type { Capability } from "./security/Capability.ts";
import { emitNotification, emitNotificationSecure, emitBroadcast, type BroadcastEmitResult } from "./utils/notifications/emit.js";
import type { BroadcastInput, NotifyInput } from "./types/notifications/Notification.js";

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
	 * vive en este campo privado, inaccesible para las subclases y para código inyectado.
	 *
	 * Los accesores al registry mutable y al ModuleLoader son privados de verdad (`#`), no
	 * `protected`, a propósito: `protected` no existe en runtime, así que un accesor
	 * protected entregaría esos handles a cualquier código con la instancia y volvería
	 * inservible la lista `INFRA_ONLY` de `capabilityPolicy` (que impide declarar
	 * `registry:write` y `module:loader` en `privileges`). Los únicos consumidores son los
	 * dos métodos de bootstrap de abajo, que devuelven **datos**, nunca handles.
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

	/** Registry **mutable**. Privado real: el handle no sale de este archivo. */
	#mutableRegistry(): ModuleRegistry {
		if (!this.#kernelRef || !this.#infraCap) throw new Error(`Infra no disponible en ${this.name} (módulo no provisionado)`);
		return this.#kernelRef.getMutableRegistry(this.#infraCap);
	}

	/** Loader de módulos (instancia código, lee `.env`). Privado real: no sale de este archivo. */
	#moduleLoader(): ModuleLoader {
		if (!this.#infraCap) throw new Error(`Infra no disponible en ${this.name} (módulo no provisionado)`);
		return Kernel.getModuleLoader(this.#infraCap);
	}

	/**
	 * Cierra la ventana de infraestructura. El bootstrap de un módulo ocurre una sola vez,
	 * conducido por el kernel; a partir de ahí no queda capability con la que cargar código
	 * ni mutar el registry, ni siquiera desde dentro de estas clases base.
	 */
	#consumeInfra(): void {
		this.#infraCap = undefined;
	}

	/**
	 * Arranque de las sub‑dependencias **declaradas** del módulo (providers/utilities de su
	 * `config.json`). Devuelve la config base ya interpolada; el registry mutable y el
	 * `ModuleLoader` se quedan acá dentro.
	 *
	 * De un solo uso: al terminar consume la infraCap. Un segundo llamado lanza.
	 */
	protected async bootstrapDeclaredDeps(moduleDir: string, options?: IModuleConfig): Promise<Partial<IModuleConfig>> {
		const registry = this.#mutableRegistry();
		const moduleLoader = this.#moduleLoader();
		try {
			const envVars = await moduleLoader.loadEnvFile(path.join(moduleDir, ".env"));
			const baseConfig = await this.#readBaseConfig(moduleLoader, path.join(moduleDir, "config.json"), envVars);
			const providers = await this.#resolveProviders(moduleLoader, registry, baseConfig, envVars, options);
			// Utilities: prioridad app (options) > config.json del módulo. Son globales.
			const utilities = options?.utilities || baseConfig.utilities || [];
			await this.#loadUtilities(moduleLoader, registry, utilities, baseConfig.failOnError);
			return { ...baseConfig, providers, utilities };
		} finally {
			this.#consumeInfra();
		}
	}

	/**
	 * Carga los módulos de la definición ya mergeada del propio módulo (camino de las apps).
	 * Sin parámetros: sólo puede cargar lo que el módulo declaró en su `config`.
	 *
	 * De un solo uso, ídem {@link bootstrapDeclaredDeps}.
	 */
	protected async loadDefinitionModules(): Promise<void> {
		if (!this.#kernelRef) throw new Error(`Infra no disponible en ${this.name} (módulo no provisionado)`);
		const moduleLoader = this.#moduleLoader();
		try {
			await moduleLoader.loadAllModulesFromDefinition(this.config, this.#kernelRef);
		} finally {
			this.#consumeInfra();
		}
	}

	/** Lee e interpola el `config.json` del módulo (objeto vacío si no existe o no parsea). */
	async #readBaseConfig(
		moduleLoader: ModuleLoader,
		modulesConfigPath: string,
		envVars: Record<string, string>
	): Promise<Partial<IModuleConfig>> {
		try {
			const configContent = await fs.readFile(modulesConfigPath, "utf-8");
			const rawConfig = safeParseJson(configContent, moduleConfigCheck);
			if (rawConfig) return moduleLoader.interpolateEnvVars(rawConfig, envVars);
		} catch (e: any) {
			this.logger.logDebug(`No se pudo leer config.json: ${e.message}`);
		}
		return {};
	}

	/**
	 * Providers efectivos del módulo: si la app los proporciona (options), se usan esos
	 * (ya cargados); si no, se cargan los del `config.json` propio.
	 */
	async #resolveProviders(
		moduleLoader: ModuleLoader,
		registry: ModuleRegistry,
		baseConfig: Partial<IModuleConfig>,
		envVars: Record<string, string>,
		options?: IModuleConfig
	): Promise<IModuleConfig["providers"]> {
		const fromApp = options?.providers || [];
		if (fromApp.length > 0) return fromApp;
		if (!baseConfig.providers || !Array.isArray(baseConfig.providers)) return fromApp;

		// Cargar los providers del config.json con las variables de entorno del módulo
		// (`baseConfig` ya viene interpolado, así que la uniqueKey coincide con la del registro).
		for (const providerConfig of baseConfig.providers) {
			try {
				const keyConfig = moduleKeyConfig(providerConfig);

				// Este es el camino por el que se cargan casi todos los providers del árbol: las
				// entradas `services` de un `config.json` de app rara vez declaran `providers`, así
				// que el chequeo equivalente de `ModuleLoader` no llega a correr. Sin este guard,
				// cada servicio que declara p.ej. `object/mongo` con el mismo `custom` abría su
				// propia conexión, y `registerProvider` la descartaba silenciosamente al ver la key
				// ya ocupada: la instancia quedaba sin dueño, sin `stop()` y con el socket vivo.
				if (registry.hasModule("provider", providerConfig.name, keyConfig)) {
					registry.addModuleDependency("provider", providerConfig.name, keyConfig);
					continue;
				}

				const provider = await moduleLoader.loadProvider(providerConfig, envVars);
				registry.registerProvider(provider.name, provider, providerConfig);
				// También registrar por el nombre del módulo/configuración
				if (providerConfig.name !== provider.name) {
					registry.registerProvider(providerConfig.name, provider, providerConfig);
				}
				// Agregar como dependencia de la app actual
				registry.addModuleDependency("provider", providerConfig.name, keyConfig);
			} catch (error) {
				const message = `Error cargando provider ${providerConfig.name}`;
				// failOnError puede venir del config.json del módulo
				if (baseConfig.failOnError) throw new Error(message, { cause: error });
				this.logger.logWarn(message);
			}
		}
		return baseConfig.providers;
	}

	/** Carga y registra las utilities del módulo (con alias por nombre base si contiene "/"). */
	async #loadUtilities(
		moduleLoader: ModuleLoader,
		registry: ModuleRegistry,
		utilitiesToLoad: IModuleConfig["utilities"],
		failOnError: boolean | undefined
	): Promise<void> {
		if (!utilitiesToLoad || !Array.isArray(utilitiesToLoad)) return;
		for (const utilityConfig of utilitiesToLoad) {
			try {
				// Mismo razonamiento que el guard de providers de acá arriba, y por el mismo
				// motivo: éste es el camino por el que se cargan casi todas las utilities del
				// árbol, así que sin deduplicar, una utility declarada por N servicios se
				// construía e INICIABA N veces para que el registry descartara N-1.
				await moduleLoader.loadAndRegisterUtility(registry, utilityConfig, null);
			} catch (error: any) {
				const message = `Error cargando utility ${utilityConfig.name}: ${error.message}`;
				this.logger.logError(message);
				if (failOnError) throw new Error(message, { cause: error });
				else throw error; // Re-lanzar para que el módulo no se registre
			}
		}
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
	 *
	 * Chequea disponibilidad en el registry ANTES de resolver, así una dependencia
	 * opcional ausente no dispara el log de error de una resolución fallida.
	 */
	protected tryGetMyService<S>(name: string, config?: IModuleConfig): S | undefined {
		try {
			const serviceConfig = config || this.#findDeclared(this.config?.services, name);
			if (!serviceConfig) return undefined;
			const registry = this.#requireRegistry();
			const loaded = serviceConfig.custom
				? registry.hasModule("service", name, serviceConfig.custom)
				: registry.hasAnyModule("service", name);
			if (!loaded) return undefined;
			return this.getMyService<S>(name, serviceConfig);
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
	 *
	 * Estampa `origin` con el `name` del módulo (ignorando el que venga en `input`):
	 * `NotificationService` lo usa para autorizar topics reservados (`security.*`).
	 */
	protected async emitNotification(input: NotifyInput): Promise<void> {
		try {
			const ok = await emitNotification(this.#requireRegistry(), { ...input, origin: this.name });
			if (!ok) this.logger.logDebug(`Notificación descartada (subsistema no disponible): topic=${input.topic}`);
		} catch (e) {
			// Defensa extra: emitNotification ya es no-throw, pero nunca propagamos.
			this.logger.logWarn(`emitNotification falló (ignorado): ${(e as Error).message}`);
		}
	}

	/**
	 * Emite una notificación de **topic reservado** (`security.*`) reenviando la
	 * **capability** del módulo: `NotificationService` deriva el `origin` de `cap.owner`
	 * (infalsificable) en vez de confiar en el payload, y sólo la acepta si el módulo
	 * porta `identity:internal` y su owner está allowlisted para ese topic. Entrega
	 * directa en proceso (sin cola durable). **Nunca lanza.**
	 */
	protected async emitSecureNotification(input: NotifyInput): Promise<void> {
		try {
			const ok = await emitNotificationSecure(this.#requireRegistry(), this.getCapability(), { ...input, origin: this.name });
			if (!ok) this.logger.logDebug(`Notificación de seguridad descartada (subsistema no disponible): topic=${input.topic}`);
		} catch (e) {
			this.logger.logWarn(`emitSecureNotification falló (ignorado): ${(e as Error).message}`);
		}
	}

	/**
	 * Broadcast a TODOS los usuarios activos, reenviando la capability del módulo:
	 * `NotificationService.broadcast` sólo lo acepta si porta el scope
	 * `notifications:broadcast` (opt-in en `config.json`). **Nunca lanza**; devuelve
	 * el modo real de despacho (`queued`/`direct`/`dropped`).
	 */
	protected async emitBroadcast(input: BroadcastInput): Promise<BroadcastEmitResult> {
		try {
			return await emitBroadcast(this.#requireRegistry(), this.getCapability(), { ...input, origin: this.name });
		} catch (e) {
			this.logger.logWarn(`emitBroadcast descartado (${input.topic}): ${(e as Error).message}`);
			return "dropped";
		}
	}
}
