import type { RegisteredUIModule } from "../../types.js";

export interface SwTemplateContext {
	namespace: string;
	moduleName: string;
	cacheRevision: string;
	isDevelopment: boolean;
	i18nNamespaces: string[];
}

/** Calcula la revisión de caché de un módulo en función de sus UI libraries. */
export function createCacheRevision(module: RegisteredUIModule, namespaceModules: Map<string, RegisteredUIModule>): string {
	const uiLibraryRevisions = Array.from(namespaceModules.values())
		.filter((mod) => mod.uiConfig.framework === "stencil")
		.map((mod) => `${mod.name}-${mod.registeredAt || 0}`)
		.sort((a, b) => a.localeCompare(b))
		.join("-");

	return `${module.name}-${module.registeredAt || Date.now()}-${uiLibraryRevisions || "no-ui-library"}`.replaceAll(/[^a-zA-Z0-9_-]/g, "-");
}

/** Calcula los namespaces de i18n disponibles en este namespace UI. */
export function collectI18nNamespaces(namespaceModules: Map<string, RegisteredUIModule>): string[] {
	const i18nNamespaces: string[] = [];
	for (const [name, mod] of namespaceModules.entries()) {
		if (mod.uiConfig.i18n) i18nNamespaces.push(name);
	}
	return i18nNamespaces;
}
