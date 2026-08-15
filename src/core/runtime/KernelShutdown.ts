import type { ILogger } from "../../interfaces/utils/ILogger.js";
import type { ModuleRegistry } from "../../utils/registry/ModuleRegistry.js";
import type { DockerManager } from "../../utils/system/DockerManager.js";
import { stopBoundModule } from "../../utils/decorators/OnlyKernel.ts";

type WithTimeoutFn = <T>(promise: Promise<T>, timeoutMs: number, name: string) => Promise<T | undefined>;

/**
 * Cuánto se espera a que **el balanceador vea el 503** antes de empezar a apagar cosas. Sin esta
 * pausa el drenaje es simbólico: se saca el nodo de rotación y se lo apaga en el mismo instante, así
 * que las requests en vuelo mueren igual. `0` en desarrollo, donde no hay balanceador que avisar.
 */
const DRAIN_WAIT_MS = Math.max(0, Number(process.env.ADC_DRAIN_MS ?? (process.env.NODE_ENV === "production" ? 5000 : 0)));

/**
 * Presupuesto para bajar **cada** stack de infraestructura, por separado. Un presupuesto común no
 * alcanza: `docker compose down` ya tiene 10 s de gracia por contenedor, así que el timeout saltaba
 * siempre y a `mongod` le llegaba un SIGKILL de rutina — y un mongod con `--replSet` matado a mitad
 * de un checkpoint puede necesitar recuperación al arrancar.
 */
const INFRA_STOP_TIMEOUT_MS = Math.max(30_000, Number(process.env.ADC_SHUTDOWN_INFRA_TIMEOUT_MS) || 180_000);

/**
 * Orden de apagado de la infraestructura: **primero lo que produce trabajo, último lo que guarda
 * datos**. Bajar Mongo antes que Rabbit dejaría a los consumidores escribiendo contra una base que
 * ya no está.
 *
 * Lo que no figure acá se apaga después, en el orden en que se levantó.
 */
const INFRA_STOP_ORDER = ["adc-haraka-core", "adc-rabbit-core", "adc-redis-core", "adc-garage-core", "adc-mongo-core"];

function createWithTimeout(logger: ILogger, abandoned: string[]): WithTimeoutFn {
	return async <T>(promise: Promise<T>, timeoutMs: number, name: string): Promise<T | undefined> => {
		let timeoutId: ReturnType<typeof setTimeout> | undefined;
		const timeoutPromise = new Promise<undefined>((resolve) => {
			timeoutId = setTimeout(() => {
				// `Promise.race` abandona la promesa, no la cancela: el trabajo sigue corriendo suelto,
				// así que se anota para poder decir al final QUÉ quedó a medias.
				abandoned.push(name);
				logger.logWarn(`Timeout deteniendo ${name} (${timeoutMs}ms)`);
				resolve(undefined);
			}, timeoutMs);
		});
		try {
			return await Promise.race([promise, timeoutPromise]);
		} finally {
			if (timeoutId) clearTimeout(timeoutId);
		}
	};
}

/**
 * Saca el nodo de rotación y suelta el rol de trabajos de fondo, **antes** de parar nada.
 *
 * En el `stop()` de cada servicio llegaría tarde: `ModuleRegistry` para providers antes que
 * services, así que el provider de Redis ya cerró, las llamadas fallan y sus `.catch()` lo dejan
 * invisible. El nodo quedaba anunciado como vivo hasta que vencía el TTL, recibiendo tráfico que ya
 * no podía servir.
 *
 * Se resuelve por nombre y con `hasAnyModule`: los dos servicios son opcionales.
 */
async function drainNode(registry: ModuleRegistry, logger: ILogger): Promise<void> {
	if (registry.hasAnyModule("service", "ClusterService")) {
		try {
			await registry.getService<{ beginDrain(): Promise<void> }>("ClusterService").beginDrain();
		} catch (error) {
			logger.logWarn(`No se pudo drenar el nodo: ${(error as Error).message}`);
		}
	}
	if (registry.hasAnyModule("service", "OperationsService")) {
		try {
			await registry.getService<{ releaseBackgroundRole(): Promise<void> }>("OperationsService").releaseBackgroundRole();
		} catch (error) {
			logger.logWarn(`No se pudo soltar el rol de trabajos de fondo: ${(error as Error).message}`);
		}
	}
	if (DRAIN_WAIT_MS > 0) {
		logger.logInfo(`Drenando ${DRAIN_WAIT_MS}ms para que el balanceador vea el 503...`);
		await new Promise((resolve) => setTimeout(resolve, DRAIN_WAIT_MS));
	}
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
		const stopped = await withTimeout(stopBoundModule(instance, kernelKey), 5000, `App ${name}`);
		// Si el `stop()` se pasó del presupuesto la app sigue corriendo suelta, y bajarle el docker
		// sería sacarle la infraestructura mientras todavía la usa.
		if (stopped !== undefined) await stopAppDocker(name.split(":")[0], dockerManager, withTimeout, logger);
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
	const abandoned: string[] = [];
	const withTimeout = createWithTimeout(logger, abandoned);

	logger.logInfo("Sacando el nodo de rotación...");
	await drainNode(registry, logger);

	logger.logInfo(`Deteniendo Apps...`);
	for (const [name, instance] of registry.getAppsRegistry()) {
		await stopApp(name, instance, kernelKey, dockerManager, withTimeout, logger);
	}

	await registry.stopAllModules(kernelKey, withTimeout);

	// La infraestructura va al final y SIN prisa: los módulos todavía la estaban usando, y es lo
	// único que guarda datos en disco.
	logger.logInfo("Deteniendo contenedores Docker comunes...");
	await dockerManager.stopAllCommonDockerCompose({
		order: INFRA_STOP_ORDER,
		timeoutMsPerStack: INFRA_STOP_TIMEOUT_MS,
	});

	if (abandoned.length > 0) {
		logger.logWarn(`Cierre completado con ${abandoned.length} módulo(s) abandonado(s) por timeout: ${abandoned.join(", ")}`);
	} else {
		logger.logOk("Cierre completado.");
	}
}
