import type { ILogger } from "../../interfaces/utils/ILogger.js";
import type { ModuleRegistry } from "../../utils/registry/ModuleRegistry.js";
import type { DockerManager } from "../../utils/system/DockerManager.js";

export type WithTimeoutFn = <T>(promise: Promise<T>, timeoutMs: number, name: string) => Promise<T | undefined>;

export function createWithTimeout(logger: ILogger): WithTimeoutFn {
	return async <T>(promise: Promise<T>, timeoutMs: number, name: string): Promise<T | undefined> => {
		const timeoutPromise = new Promise<undefined>((resolve) => {
			setTimeout(() => {
				logger.logWarn(`Timeout deteniendo ${name} (${timeoutMs}ms)`);
				resolve(undefined);
			}, timeoutMs);
		});
		return Promise.race([promise, timeoutPromise]);
	};
}

async function stopAppDocker(appBaseName: string, dockerManager: DockerManager, withTimeout: WithTimeoutFn, logger: ILogger): Promise<void> {
	if (!dockerManager.hasAppDockerCompose(appBaseName)) return;
	const appDir = dockerManager.getAppDockerComposeDir(appBaseName);
	if (!appDir) return;
	try {
		await withTimeout(dockerManager.stopDockerCompose(appDir), 5000, `Docker ${appBaseName}`);
		dockerManager.deleteAppDockerCompose(appBaseName);
	} catch (e) {
		logger.logWarn(`Error deteniendo Docker para App ${appBaseName}: ${e}`);
	}
}

async function stopApp(
	name: string,
	instance: any,
	kernelKey: symbol,
	dockerManager: DockerManager,
	withTimeout: WithTimeoutFn,
	logger: ILogger
): Promise<void> {
	try {
		logger.logDebug(`Deteniendo App ${name}`);
		if (instance.stop) {
			await withTimeout(instance.stop(kernelKey), 3000, `App ${name}`);
		}
		await stopAppDocker(name.split(":")[0], dockerManager, withTimeout, logger);
	} catch (e) {
		logger.logError(`Error deteniendo App ${name}: ${e}`);
	}
}

export async function shutdownKernel(deps: {
	logger: ILogger;
	registry: ModuleRegistry;
	dockerManager: DockerManager;
	kernelKey: symbol;
}): Promise<void> {
	const { logger, registry, dockerManager, kernelKey } = deps;
	const withTimeout = createWithTimeout(logger);

	logger.logInfo(`Deteniendo Apps...`);
	for (const [name, instance] of registry.getAppsRegistry()) {
		await stopApp(name, instance, kernelKey, dockerManager, withTimeout, logger);
	}

	await registry.stopAllModules(kernelKey, withTimeout);

	logger.logInfo("Deteniendo contenedores Docker comunes...");
	await withTimeout(dockerManager.stopAllCommonDockerCompose(), 10000, "Docker comunes");
	logger.logOk("Cierre completado.");
}
