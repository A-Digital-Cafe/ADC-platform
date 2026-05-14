import type { RegisteredUIModule } from "../../types.js";

/**
 * Encapsula el mapa anidado Map<namespace, Map<moduleName, module>>
 * y operaciones de lookup comunes.
 */
export class ModuleRegistry {
	readonly byNamespace = new Map<string, Map<string, RegisteredUIModule>>();

	getNamespaceModules(namespace: string): Map<string, RegisteredUIModule> {
		let modules = this.byNamespace.get(namespace);
		if (!modules) {
			modules = new Map();
			this.byNamespace.set(namespace, modules);
		}
		return modules;
	}

	getModule(namespace: string, name: string): RegisteredUIModule | null {
		return this.byNamespace.get(namespace)?.get(name) ?? null;
	}

	getHostModule(namespace: string): RegisteredUIModule | null {
		const modules = this.byNamespace.get(namespace);
		if (!modules) return null;
		for (const mod of modules.values()) {
			if (mod.uiConfig.isHost) return mod;
		}
		return null;
	}

	findModuleByName(name: string): { namespace: string; module: RegisteredUIModule } | null {
		for (const [namespace, modules] of this.byNamespace.entries()) {
			const found = modules.get(name);
			if (found) return { namespace, module: found };
		}
		return null;
	}

	get namespaces(): string[] {
		return Array.from(this.byNamespace.keys());
	}

	get allModules(): RegisteredUIModule[] {
		const all: RegisteredUIModule[] = [];
		for (const modules of this.byNamespace.values()) all.push(...modules.values());
		return all;
	}
}
