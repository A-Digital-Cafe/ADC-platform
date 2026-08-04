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
 * Qué UI library se queda con los aliases legacy `@ui-library*` cuando el módulo declara
 * más de una. **Nunca por posición en el array**: `adc-ui-library` y `media-ui-library`
 * exportan las dos un dir `utils` (con su `react-jsx.ts`), así que reordenar
 * `uiDependencies` cambiaba silenciosamente a qué library resuelve `@ui-library/utils` —
 * mismo alias, otro archivo, cero errores hasta el runtime.
 *
 * Orden de decisión (siempre declarativo, nunca posicional):
 *  1. `uiLibraryAlias` del consumidor (por nombre);
 *  2. la única library declarada, si hay una sola;
 *  3. la que se declare `isPrimaryUILibrary` (la raíz de su namespace);
 *  4. la primera, avisando: la ambigüedad queda en el log en vez de resolverse en secreto.
 */
function resolveLegacyAliasOwner(
	uiLibraries: RegisteredUIModule[],
	targetModule: RegisteredUIModule,
	logger?: { logWarn(msg: string): void }
): RegisteredUIModule {
	const requested = targetModule.uiConfig.uiLibraryAlias;
	if (requested) {
		const match = uiLibraries.find((lib) => lib.uiConfig.name === requested || lib.name === requested);
		if (match) return match;
		logger?.logWarn(
			`[aliases] ${targetModule.name}: uiLibraryAlias="${requested}" no está entre sus UI libraries ` +
				`(${uiLibraries.map((l) => l.uiConfig.name).join(", ")}); se ignora.`
		);
	}
	if (uiLibraries.length === 1) return uiLibraries[0];

	const primaries = uiLibraries.filter((lib) => lib.uiConfig.isPrimaryUILibrary);
	if (primaries.length === 1) return primaries[0];

	logger?.logWarn(
		`[aliases] ${targetModule.name} declara ${uiLibraries.length} UI libraries ` +
			`(${uiLibraries.map((l) => l.uiConfig.name).join(", ")}) y ninguna resuelve el alias legacy de forma unívoca: ` +
			`@ui-library* apunta a "${uiLibraries[0].uiConfig.name}" por orden de declaración. ` +
			`Marcá una con "isPrimaryUILibrary": true o fijala con "uiLibraryAlias".`
	);
	return uiLibraries[0];
}

/**
 * Inyecta los aliases de cada UI library en el mapa proporcionado.
 * Cada lib obtiene aliases name-scoped (`@<name>`, `@<name>/utils`, ...); la elegida por
 * {@link resolveLegacyAliasOwner} conserva además los aliases legacy `@ui-library*`.
 */
export function addUILibraryAliases(
	aliases: Record<string, string>,
	uiLibraries: RegisteredUIModule[],
	uiOutputBaseDir: string,
	targetModule: RegisteredUIModule,
	logger?: { logWarn(msg: string): void }
): void {
	for (const uiLibrary of uiLibraries) {
		addAliasesWithPrefix(aliases, uiLibrary, uiOutputBaseDir, `@${uiLibrary.uiConfig.name}`);
	}
	// El legacy va DESPUÉS de los name-scoped: si la elegida no fuera la primera, escribir
	// antes dejaría que su propio bloque name-scoped pisara claves compartidas.
	addAliasesWithPrefix(aliases, resolveLegacyAliasOwner(uiLibraries, targetModule, logger), uiOutputBaseDir, "@ui-library");
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
