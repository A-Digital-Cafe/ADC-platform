import type { ModuleRegistry, ModuleType } from "./ModuleRegistry.js";
import type { IApp } from "../../interfaces/modules/IApp.js";

/**
 * Vista **sólo‑lectura** del {@link ModuleRegistry} que se entrega a la lógica de
 * negocio de los módulos. Permite *obtener* (resolver) services/providers/utilities,
 * pero no *administrar* (registrar/descargar): las mutaciones quedan reservadas a la
 * maquinaria de infraestructura, que accede al registry mutable vía capability.
 *
 * Es un wrapper real (no sólo un tipo): delega únicamente los métodos de lectura, de
 * modo que un módulo no puede recastear el handle para mutar.
 */
export class ReadonlyModuleRegistry {
	readonly #registry: ModuleRegistry;

	constructor(registry: ModuleRegistry) {
		this.#registry = registry;
	}

	getProvider<T>(name: string, config?: Record<string, any>): T {
		return this.#registry.getProvider<T>(name, config);
	}

	getUtility<T>(name: string, config?: Record<string, any>): T {
		return this.#registry.getUtility<T>(name, config);
	}

	getService<T>(name: string, config?: Record<string, any>): T {
		return this.#registry.getService<T>(name, config);
	}

	hasModule(moduleType: ModuleType, name: string, config?: Record<string, any>): boolean {
		return this.#registry.hasModule(moduleType, name, config);
	}

	getApp(name: string): IApp {
		return this.#registry.getApp(name);
	}

	hasApp(name: string): boolean {
		return this.#registry.hasApp(name);
	}

	getModuleNames(moduleType: ModuleType): string[] {
		return this.#registry.getModuleNames(moduleType);
	}
}
