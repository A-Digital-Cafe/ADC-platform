import * as path from "node:path";
import type { RegisteredUIModule } from "../../types.js";

/** Busca todas las UI libraries (Stencil) declaradas como dependencia del módulo, en orden de declaración. */
export function findUILibraries(modules: Map<string, RegisteredUIModule>, targetModule: RegisteredUIModule): RegisteredUIModule[] {
	const uiDependencies = targetModule.uiConfig.uiDependencies || [];
	const libraries: RegisteredUIModule[] = [];

	for (const depName of uiDependencies) {
		const depModule = modules.get(depName);
		if (depModule?.uiConfig.framework === "stencil") {
			libraries.push(depModule);
		}
	}

	return libraries;
}

function addAliasesWithPrefix(aliases: Record<string, string>, uiLibrary: RegisteredUIModule, uiOutputBaseDir: string, prefix: string): void {
	const exports = uiLibrary.uiConfig.exports || {};
	const outputDir = path.resolve(uiOutputBaseDir, uiLibrary.uiConfig.name);

	for (const [exportName, exportPath] of Object.entries(exports)) {
		const aliasKey = `${prefix}/${exportName}`;

		if (exportName === "loader") {
			aliases[aliasKey] = path.resolve(outputDir, exportPath);
		} else {
			aliases[aliasKey] = path.resolve(uiLibrary.appDir, exportPath);
		}
	}

	// <prefix>/styles -> CSS base de la UI library (para Tailwind)
	aliases[`${prefix}/styles`] = path.resolve(outputDir, "styles.css");

	// <prefix> -> init.js (auto-ejecuta loader + registra componentes)
	// Debe ir DESPUÉS de subrutas específicas para que Rspack no capture <prefix>/styles con el alias base.
	aliases[prefix] = path.resolve(outputDir, "init.js");
}

/**
 * Inyecta los aliases de cada UI library en el mapa proporcionado.
 * Cada lib obtiene aliases name-scoped (`@<name>`, `@<name>/utils`, ...); la primera
 * conserva además los aliases legacy `@ui-library*`.
 */
export function addUILibraryAliases(aliases: Record<string, string>, uiLibraries: RegisteredUIModule[], uiOutputBaseDir: string): void {
	uiLibraries.forEach((uiLibrary, index) => {
		addAliasesWithPrefix(aliases, uiLibrary, uiOutputBaseDir, `@${uiLibrary.uiConfig.name}`);
		if (index === 0) {
			addAliasesWithPrefix(aliases, uiLibrary, uiOutputBaseDir, "@ui-library");
		}
	});
}

/** Indica si el módulo usa React (framework o sharedLib). */
export function usesReact(module: RegisteredUIModule): boolean {
	const framework = module.uiConfig.framework || "";
	return framework === "react" || framework === "vite-react" || (module.uiConfig.sharedLibs?.includes("react") ?? false);
}

/** Normaliza un nombre de framework (quita prefijo `vite-`). */
function normalizeFramework(framework: string): string {
	return framework.startsWith("vite-") ? framework.replaceAll("vite-", "") : framework;
}

/** Detecta todos los frameworks usados por los módulos registrados (para resolver chunks). */
export function detectUsedFrameworks(registeredModules: Map<string, RegisteredUIModule>, targetModule: RegisteredUIModule): Set<string> {
	const usedFrameworks = new Set<string>();
	const framework = targetModule.uiConfig.framework || "vanilla";

	if (framework !== "vanilla") {
		const base = normalizeFramework(framework);
		if (base !== "vanilla") usedFrameworks.add(base);
	}

	targetModule.uiConfig.sharedLibs?.forEach((lib) => usedFrameworks.add(lib));

	// Frameworks de dependencias declaradas
	for (const depName of targetModule.uiConfig.uiDependencies || []) {
		const depModule = registeredModules.get(depName);
		if (!depModule) continue;
		const base = normalizeFramework(depModule.uiConfig.framework || "vanilla");
		if (base !== "vanilla" && base !== "stencil") usedFrameworks.add(base);
	}

	// Hosts/layouts: detectar frameworks de todos los remotes en el namespace
	// (necesario porque los remotes se cargan dinámicamente con lazyLoadRemoteComponent)
	if (targetModule.uiConfig.isHost ?? false) {
		addRemoteFrameworks(usedFrameworks, registeredModules, targetModule);
	}

	return usedFrameworks;
}

function addRemoteFrameworks(
	usedFrameworks: Set<string>,
	registeredModules: Map<string, RegisteredUIModule>,
	targetModule: RegisteredUIModule
): void {
	const namespace = targetModule.namespace || "default";

	for (const [moduleName, mod] of registeredModules.entries()) {
		const modNamespace = mod.namespace || "default";
		const isLayoutModule = moduleName.includes("layout");
		const isCurrentModule = moduleName === targetModule.uiConfig.name;

		if (isLayoutModule || isCurrentModule || !mod.uiConfig.devPort || modNamespace !== namespace) continue;

		const base = normalizeFramework(mod.uiConfig.framework || "vanilla");
		if (base !== "vanilla" && base !== "stencil") usedFrameworks.add(base);
	}
}
