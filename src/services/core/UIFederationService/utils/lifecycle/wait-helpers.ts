import type { ILogger } from "../../../../../interfaces/utils/ILogger.js";
import type { RegisteredUIModule } from "../../types.js";

const UI_LIBRARY_TIMEOUT_MS = 60000;
const REMOTES_TIMEOUT_MS = 30000;
const CHECK_INTERVAL_MS = 500;

function findUILibrary(modules: Map<string, RegisteredUIModule>): RegisteredUIModule | null {
	for (const mod of modules.values()) {
		if (mod.uiConfig.framework === "stencil") return mod;
	}
	return null;
}

async function waitUntilTerminal(mod: RegisteredUIModule, maxWaitMs: number): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < maxWaitMs) {
		if (mod.buildStatus === "built" || mod.buildStatus === "error") return;
		await new Promise((resolve) => setTimeout(resolve, CHECK_INTERVAL_MS));
	}
}

/**
 * Espera a que la UI library (Stencil) del namespace termine de construirse.
 */
export async function waitForUILibraryBuild(
	namespaceModules: Map<string, RegisteredUIModule>,
	waitingModuleName: string,
	logger: ILogger
): Promise<void> {
	const uiLibrary = findUILibrary(namespaceModules);
	if (!uiLibrary || uiLibrary.buildStatus === "built") return;
	if (uiLibrary.buildStatus !== "building" && uiLibrary.buildStatus !== "pending") return;

	logger.logDebug(`${waitingModuleName} esperando a que ${uiLibrary.name} termine de construirse...`);
	await waitUntilTerminal(uiLibrary, UI_LIBRARY_TIMEOUT_MS);

	const finalStatus = uiLibrary.buildStatus as RegisteredUIModule["buildStatus"];
	if (finalStatus === "built") {
		logger.logDebug(`${uiLibrary.name} listo, ${waitingModuleName} puede continuar`);
	} else if (finalStatus === "error") {
		logger.logWarn(`${uiLibrary.name} falló, ${waitingModuleName} continuará sin UI library`);
	} else {
		logger.logWarn(`Timeout esperando ${uiLibrary.name}, ${waitingModuleName} continuará de todas formas`);
	}
}

function isRemoteMissing(dep: RegisteredUIModule | undefined): boolean {
	if (!dep) return true;
	return dep.buildStatus !== "built" && dep.uiConfig.framework !== "stencil";
}

function getMissingRemotes(deps: string[], modules: Map<string, RegisteredUIModule>): string[] {
	return deps.filter((name) => isRemoteMissing(modules.get(name)));
}

function isStillPending(mod: RegisteredUIModule | undefined): boolean {
	return !mod || mod.buildStatus === "pending" || mod.buildStatus === "building";
}

async function pollUntilRemotesReady(missing: string[], modules: Map<string, RegisteredUIModule>): Promise<string[]> {
	let elapsed = 0;
	let current = missing;
	while (elapsed < REMOTES_TIMEOUT_MS && current.length > 0) {
		current = current.filter((name) => isStillPending(modules.get(name)));
		if (current.length === 0) return [];
		await new Promise((resolve) => setTimeout(resolve, CHECK_INTERVAL_MS));
		elapsed += CHECK_INTERVAL_MS;
	}
	return current;
}

/**
 * Espera a que los remotes declarados en uiDependencies estén registrados/construidos.
 */
export async function waitForDeclaredRemotes(
	hostModule: RegisteredUIModule,
	namespaceModules: Map<string, RegisteredUIModule>,
	logger: ILogger
): Promise<void> {
	const uiDependencies = hostModule.uiConfig.uiDependencies || [];
	if (uiDependencies.length === 0) return;

	const missing = getMissingRemotes(uiDependencies, namespaceModules);
	if (missing.length === 0) return;

	logger.logDebug(`${hostModule.name} esperando remotes: ${missing.join(", ")}`);
	const stillMissing = await pollUntilRemotesReady(missing, namespaceModules);

	if (stillMissing.length === 0) {
		logger.logDebug(`Todos los remotes listos para ${hostModule.name}`);
		return;
	}

	logger.logWarn(
		`Timeout esperando remotes para ${hostModule.name}: ${stillMissing.join(", ")}. ` +
			`El host se construirá sin ellos (se agregarán cuando se registren).`
	);
}
