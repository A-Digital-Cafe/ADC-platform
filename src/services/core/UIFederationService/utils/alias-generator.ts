import * as path from "node:path";
import type { RegisteredUIModule } from "../types.js";

/**
 * Genera aliases dinámicos para bundlers basados en los exports de la ui-library
 * y las utilidades del core según las sharedLibs del módulo.
 * Simplificado: singleton a nivel de módulo con funciones puras.
 */

// Funciones internas
function findUILibrary(modules: Map<string, RegisteredUIModule>, targetModule: RegisteredUIModule): RegisteredUIModule | null {
	const uiDependencies = targetModule.uiConfig.uiDependencies || [];

	for (const depName of uiDependencies) {
		const depModule = modules.get(depName);
		if (depModule && depModule.uiConfig.framework === "stencil") {
			return depModule;
		}
	}

	return null;
}

function addUILibraryAliases(aliases: Record<string, string>, uiLibrary: RegisteredUIModule, uiOutputBaseDir: string): void {
	const exports = uiLibrary.uiConfig.exports || {};
	const uiModuleName = uiLibrary.uiConfig.name;
	const outputDir = path.resolve(uiOutputBaseDir, uiModuleName);

	// Exports declarados en config.json
	for (const [exportName, exportPath] of Object.entries(exports)) {
		const aliasKey = `@ui-library/${exportName}`;

		if (exportName === "loader") {
			// Loader está en el output dir
			aliases[aliasKey] = path.resolve(outputDir, exportPath);
		} else {
			// Otros exports (utils, etc.) están en el source
			aliases[aliasKey] = path.resolve(uiLibrary.appDir, exportPath);
		}
	}

	// @ui-library/styles -> CSS base de la UI library (para Tailwind)
	aliases["@ui-library/styles"] = path.resolve(outputDir, "styles.css");

	// @ui-library -> init.js (auto-ejecuta loader + registra componentes)
	// Mantenerlo despues de subrutas especificas para que Rspack no capture @ui-library/styles con el alias base.
	aliases["@ui-library"] = path.resolve(outputDir, "init.js");
}

function usesReact(module: RegisteredUIModule): boolean {
	const framework = module.uiConfig.framework || "";
	return framework === "react" || framework === "vite-react" || (module.uiConfig.sharedLibs?.includes("react") ?? false);
}

/** Singleton de AliasGenerator */
export default {
	/** Genera aliases para un módulo específico */
	generate(
		registeredModules: Map<string, RegisteredUIModule>,
		uiOutputBaseDir: string,
		targetModule: RegisteredUIModule
	): Record<string, string> {
		const aliases: Record<string, string> = {};

		const uiLibrary = findUILibrary(registeredModules, targetModule);
		if (uiLibrary) {
			addUILibraryAliases(aliases, uiLibrary, uiOutputBaseDir);
		}

		if (usesReact(targetModule)) {
			aliases["@adc/utils"] = path.resolve(process.cwd(), "src/utils");
		}

		// Alias para código común compartido (proto types, interfaces, etc.)
		aliases["@common"] = path.resolve(process.cwd(), "src/common");

		return aliases;
	},

	/** Genera aliases formateados para configuración de Rspack (escapando backslashes) */
	generateForRspack(registeredModules: Map<string, RegisteredUIModule>, uiOutputBaseDir: string, targetModule: RegisteredUIModule): string {
		const aliases = this.generate(registeredModules, uiOutputBaseDir, targetModule);

		if (Object.keys(aliases).length === 0) {
			return "{}";
		}

		const aliasEntries = Object.entries(aliases)
			.map(([key, value]) => `            '${key}': '${value.replaceAll("\\", "\\\\")}'`)
			.join(",\n");

		return `{\n${aliasEntries}\n        }`;
	},

	/** Detecta todos los frameworks usados por los módulos registrados */
	detectUsedFrameworks(registeredModules: Map<string, RegisteredUIModule>, targetModule: RegisteredUIModule): Set<string> {
		const usedFrameworks = new Set<string>();
		const framework = targetModule.uiConfig.framework || "vanilla";

		if (framework !== "vanilla") {
			const baseFramework = framework.startsWith("vite-") ? framework.replaceAll("vite-", "") : framework;
			if (baseFramework !== "vanilla") {
				usedFrameworks.add(baseFramework);
			}
		}

		if (targetModule.uiConfig.sharedLibs) {
			targetModule.uiConfig.sharedLibs.forEach((lib) => usedFrameworks.add(lib));
		}

		// Detectar frameworks de dependencias declaradas
		const uiDependencies = targetModule.uiConfig.uiDependencies || [];
		for (const depName of uiDependencies) {
			const depModule = registeredModules.get(depName);
			if (depModule) {
				const depFramework = depModule.uiConfig.framework || "vanilla";
				const baseDepFramework = depFramework.startsWith("vite-") ? depFramework.replaceAll("vite-", "") : depFramework;
				if (baseDepFramework !== "vanilla" && baseDepFramework !== "stencil") {
					usedFrameworks.add(baseDepFramework);
				}
			}
		}

		// Para hosts/layouts: detectar frameworks de todos los remotes en el namespace
		// (necesario porque los remotes se cargan dinámicamente con lazyLoadRemoteComponent)
		const isHost = targetModule.uiConfig.isHost ?? false;
		if (isHost) {
			const namespace = targetModule.namespace || "default";
			for (const [moduleName, mod] of registeredModules.entries()) {
				const modNamespace = mod.namespace || "default";
				const isLayoutModule = moduleName.includes("layout");
				const isCurrentModule = moduleName === targetModule.uiConfig.name;

				// Solo incluir módulos que tengan devPort, estén en el mismo namespace, y no sean layouts ni el módulo actual
				if (!isLayoutModule && !isCurrentModule && mod.uiConfig.devPort && modNamespace === namespace) {
					const remoteFramework = mod.uiConfig.framework || "vanilla";
					const baseRemoteFramework = remoteFramework.startsWith("vite-") ? remoteFramework.replaceAll("vite-", "") : remoteFramework;
					if (baseRemoteFramework !== "vanilla" && baseRemoteFramework !== "stencil") {
						usedFrameworks.add(baseRemoteFramework);
					}
				}
			}
		}

		return usedFrameworks;
	},
};
