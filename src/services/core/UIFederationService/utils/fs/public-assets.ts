import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { RegisteredUIModule } from "../../types.js";
import type { ILogger } from "../../../../../interfaces/utils/ILogger.js";
import { getCommonPublicDir } from "./path-resolver.js";

interface PublicAssetsContext {
	/** Módulo que se está registrando */
	module: RegisteredUIModule;
	/** Mapa de módulos registrados en el namespace */
	namespaceModules: Map<string, RegisteredUIModule>;
	/** Logger para mensajes */
	logger?: ILogger;
	/** Función para registrar ruta estática */
	serveStatic: (urlPath: string, directory: string) => void;
}

/** Set para trackear directorios ya registrados (evitar duplicados) */
const registeredPublicDirs = new Set<string>();

/** Determina si un módulo es una UI library (Stencil) */
function isUILibrary(module: RegisteredUIModule): boolean {
	return module.uiConfig.framework === "stencil";
}

/**
 * Registra los assets públicos de un módulo UI y sus dependencias.
 *
 * - UI libraries (stencil): se sirven en /ui/
 * - Otros módulos: se sirven en /pub/
 * - Si el módulo tiene uiDependencies, también registra los assets de esas dependencias
 */
export async function registerPublicAssets(ctx: PublicAssetsContext): Promise<void> {
	const { module, namespaceModules, logger, serveStatic } = ctx;
	const uiDependencies = module.uiConfig.uiDependencies || [];

	// 1. common/public como fallback global (ej: favicon por defecto)
	await tryRegisterPublicDir(getCommonPublicDir(), "common", "/", logger, serveStatic, true);

	// 2. Assets públicos de las dependencias (ej: UI libraries)
	for (const depName of uiDependencies) {
		const depModule = namespaceModules.get(depName);
		if (depModule) {
			const basePath = isUILibrary(depModule) ? "/ui" : "/pub";
			await tryRegisterPublicDir(depModule.appDir, depModule.name, basePath, logger, serveStatic);
		}
	}

	// 3. Assets públicos del propio módulo (mayor prioridad)
	const basePath = isUILibrary(module) ? "/ui" : "/pub";
	await tryRegisterPublicDir(module.appDir, module.name, basePath, logger, serveStatic);
}

/**
 * Intenta registrar la carpeta public/ de un directorio de app.
 * Si no existe o ya fue registrada, no hace nada.
 * @param isDirect - Si true, usa appDir directamente en vez de appDir/public/
 */
async function tryRegisterPublicDir(
	appDir: string,
	moduleName: string,
	basePath: string,
	logger?: ILogger,
	serveStatic?: (urlPath: string, directory: string) => void,
	isDirect?: boolean
): Promise<string | null> {
	if (!serveStatic) return null;

	const publicDir = isDirect ? appDir : path.join(appDir, "public");

	if (registeredPublicDirs.has(publicDir)) {
		logger?.logDebug?.(`Public assets de ${moduleName} ya registrados`);
		return publicDir;
	}

	try {
		const stat = await fs.stat(publicDir);
		if (!stat.isDirectory()) return null;

		serveStatic(basePath, publicDir);
		registeredPublicDirs.add(publicDir);

		logger?.logOk?.(`Public assets de ${moduleName} servidos en ${basePath}/`);
		return publicDir;
	} catch {
		logger?.logDebug?.(`${moduleName} no tiene carpeta public/`);
		return null;
	}
}
