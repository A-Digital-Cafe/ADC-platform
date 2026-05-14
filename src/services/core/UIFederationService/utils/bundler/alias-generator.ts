import * as path from "node:path";
import type { RegisteredUIModule } from "../../types.js";
import { addUILibraryAliases, detectUsedFrameworks, findUILibrary, usesReact } from "./alias-helpers.js";

/**
 * Genera aliases dinámicos para bundlers basados en los exports de la ui-library
 * y las utilidades del core según las sharedLibs del módulo.
 * Singleton a nivel de módulo con funciones puras.
 */
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
		return detectUsedFrameworks(registeredModules, targetModule);
	},
};
