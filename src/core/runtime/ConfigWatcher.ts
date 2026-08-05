import * as fs from "node:fs/promises";
import * as path from "node:path";
import chokidar from "chokidar";
import type { ILogger } from "../../interfaces/utils/ILogger.js";
import type { ModuleRegistry, ModuleType } from "../../utils/registry/ModuleRegistry.js";

const FILE_EXT = ".ts";

/**
 * chokidar ≥4 NO soporta globs: siempre se vigila un DIRECTORIO y se filtra por
 * path en los handlers. Estos segmentos se podan del recorrido (build/VCS/deps).
 */
const IGNORED_SEGMENTS = new Set(["node_modules", ".git", "dist", "temp", "www", ".stencil", "coverage"]);

function isIgnoredTreePath(p: string): boolean {
	return p.split(path.sep).some((seg) => IGNORED_SEGMENTS.has(seg));
}

/** Estabilización de escritura: espera a que el archivo deje de crecer (copias/clones). */
const WRITE_FINISH = { stabilityThreshold: 2000, pollInterval: 100 };

/**
 * Techo de recorrido. Lo vigilable vive como mucho tres niveles bajo la raíz del árbol:
 * `<grupo>/<módulo>/index.<ext>`, su variante versionada (`<módulo>/1.0.0-ts/index.ts`) y los
 * configs de instancia (`<módulo>/configs/*.json`). Sin techo chokidar baja al `src/` de cada
 * app —~600 directorios vigilados al boot— y encima entrega eventos de `index.ts` internos.
 */
const WATCH_DEPTH = 3;

/** Archivos `.json` que son config de instancia de una app. */
function isInstanceConfig(p: string): boolean {
	return p.endsWith(".json") && !["default.json", "tsconfig.json", "package.json"].includes(path.basename(p));
}

/** Árbol vigilado del que salen configs de app. */
export interface ConfigTree {
	/** Raíz vigilada (`src/apps` o la raíz de un topic de preset). */
	root: string;
	/** Primer segmento bajo `root` que debe contener el config (`apps` en un preset). */
	layer?: string;
	/** Sólo `src/apps`: en producción sus configs viven copiados en `appsPath`. */
	mapToBuild?: boolean;
}

export interface ConfigWatcherDeps {
	logger: ILogger;
	registry: ModuleRegistry;
	appConfigFilePaths: ReadonlyMap<string, string>;
	removeConfigPath: (configPath: string) => void;
	appsPath: string;
	isStartingUp: () => boolean;
	isDevelopment: boolean;
	reloadAppInstance: (cfg: string) => Promise<void>;
	/**
	 * Config nuevo detectado para un app: el kernel decide si cargar (nueva instancia
	 * de un app YA corriendo) o dejar pendiente (app nueva: nunca autoejecutar).
	 */
	onNewAppConfig: (appFilePath: string) => Promise<void>;
	/** `true` si el path pertenece a un módulo pendiente (no disparar cargas/recargas). */
	isPendingPath: (p: string) => boolean;
	/**
	 * Watcher ya montado sobre `src/apps` (el que devuelve `watchLayer`). Se reutiliza para no
	 * levantar un SEGUNDO árbol recursivo idéntico sobre los mismos directorios: ambos usan
	 * la misma raíz, el mismo `ignored` y el mismo `awaitWriteFinish`, y se diferencian sólo en el
	 * filtro por archivo, que se aplica en los handlers. Opcional: sin él la clase sigue siendo
	 * construible sola.
	 */
	watcher?: ReturnType<typeof chokidar.watch>;
}

export class ConfigWatcher {
	private readonly deps: Readonly<ConfigWatcherDeps>;

	constructor(deps: ConfigWatcherDeps) {
		this.deps = Object.freeze({ ...deps });
	}

	start(): void {
		const srcAppsPath = path.resolve(process.cwd(), "src", "apps");
		const watcher =
			this.deps.watcher ??
			chokidar.watch(srcAppsPath, {
				ignoreInitial: true,
				ignored: isIgnoredTreePath,
				depth: WATCH_DEPTH,
				awaitWriteFinish: WRITE_FINISH,
			});
		this.attach(watcher, { root: srcAppsPath, mapToBuild: true });
	}

	/**
	 * Cuelga los handlers de config sobre un árbol YA vigilado. Además de `src/apps` lo usan
	 * los topics de preset: sus apps viven fuera de `src/apps`, y sin esto editar el
	 * `config.json` de una app de preset en dev no hacía nada.
	 */
	attach(watcher: ReturnType<typeof chokidar.watch>, tree: ConfigTree): void {
		// Sin globs (chokidar ≥4): filtrar los .json de interés acá.
		const relevant = (p: string) => isInstanceConfig(p) && (!tree.layer || path.relative(tree.root, p).split(path.sep)[0] === tree.layer);

		watcher.on("change", (p) => void (relevant(p) && this.#onChange(p)));
		watcher.on("add", (p) => void (relevant(p) && this.#onAdd(p)));
		watcher.on("unlink", (p) => void (relevant(p) && this.#onUnlink(p, tree)));
	}

	async #onChange(srcConfigPath: string): Promise<void> {
		if (this.deps.isStartingUp()) return;
		if (this.deps.isPendingPath(srcConfigPath)) {
			this.deps.logger.logDebug(`Config de módulo pendiente ignorada: ${path.basename(srcConfigPath)}`);
			return;
		}
		this.deps.logger.logInfo(`Detectado cambio en configuración: ${path.basename(srcConfigPath)}`);
		await this.deps.reloadAppInstance(srcConfigPath);
	}

	async #onAdd(srcConfigPath: string): Promise<void> {
		if (this.deps.isStartingUp()) return;
		const appDir = srcConfigPath.includes("/configs/") ? path.dirname(path.dirname(srcConfigPath)) : path.dirname(srcConfigPath);
		const appFilePath = path.join(appDir, `index${FILE_EXT}`);
		try {
			await fs.stat(appFilePath);
			this.deps.logger.logInfo(`Nuevo archivo de configuración detectado: ${path.basename(srcConfigPath)}`);
			await this.deps.onNewAppConfig(appFilePath);
		} catch {
			/* app no existe */
		}
	}

	async #onUnlink(srcConfigPath: string, tree: ConfigTree): Promise<void> {
		if (this.deps.isStartingUp()) return;
		const targetConfigPath = await this.#resolveDeletedConfigPath(srcConfigPath, tree);
		const instanceName = this.deps.appConfigFilePaths.get(targetConfigPath);
		if (!instanceName) return;
		this.deps.logger.logInfo(`Archivo de configuración eliminado: ${path.basename(srcConfigPath)}`);
		if (this.deps.registry.hasApp(instanceName)) {
			const app = this.deps.registry.getApp(instanceName);
			await app.stop?.();
			this.deps.registry.deleteApp(instanceName);
		}
		this.deps.removeConfigPath(targetConfigPath);
	}

	async #resolveDeletedConfigPath(srcConfigPath: string, tree: ConfigTree): Promise<string> {
		if (this.deps.isDevelopment || !tree.mapToBuild) return srcConfigPath;
		const relativePath = path.relative(tree.root, srcConfigPath);
		const target = path.join(this.deps.appsPath, relativePath);
		try {
			await fs.unlink(target);
		} catch {
			/* archivo no existe */
		}
		return target;
	}
}

/** Handlers de eventos sobre `index.<ext>` de una capa. `add` NO debe ejecutar código no aprobado. */
export interface LayerEventHandlers {
	add: (p: string) => Promise<void>;
	change: (p: string) => Promise<void>;
	unlink: (p: string) => Promise<void>;
}

export interface WatchTreeOptions {
	isStartingUp: () => boolean;
	/** Segmentos de path a excluir además de los de build/VCS (p.ej. `BaseApp.ts`). */
	exclude?: string[];
	/**
	 * `false` sólo para presets adoptados en runtime: los archivos ya presentes deben
	 * pasar por `add` (detector → pendientes), no ignorarse.
	 */
	ignoreInitial?: boolean;
}

/** Cablea los eventos filtrados de un watcher a los handlers de capa. */
function routeIndexEvents(
	watcher: ReturnType<typeof chokidar.watch>,
	relevant: (p: string) => boolean,
	handlers: (p: string) => LayerEventHandlers | null,
	isStartingUp: () => boolean
): void {
	const route = (event: keyof LayerEventHandlers) => (p: string) => {
		if (isStartingUp() || !relevant(p)) return;
		void handlers(p)?.[event](p);
	};
	watcher.on("add", route("add"));
	watcher.on("change", route("change"));
	watcher.on("unlink", route("unlink"));
}

/**
 * Vigila recursivamente el directorio de una capa (`src/services`, `src/apps`, ...)
 * y enruta los eventos de sus `index.<ext>` a los handlers.
 */
export function watchLayer(
	dir: string,
	fileExtension: string,
	handlers: LayerEventHandlers,
	opts: WatchTreeOptions
): ReturnType<typeof chokidar.watch> {
	const indexName = `index${fileExtension}`;
	const excluded = new Set(opts.exclude ?? []);
	const watcher = chokidar.watch(dir, {
		ignoreInitial: opts.ignoreInitial ?? true,
		ignored: isIgnoredTreePath,
		depth: WATCH_DEPTH,
		awaitWriteFinish: WRITE_FINISH,
	});
	const relevant = (p: string) => path.basename(p) === indexName && !p.split(path.sep).some((seg) => excluded.has(seg));
	routeIndexEvents(watcher, relevant, () => handlers, opts.isStartingUp);
	// Se devuelve para que `ConfigWatcher` pueda colgarse del mismo árbol (ver `ConfigWatcherDeps.watcher`).
	return watcher;
}

/** Capa según el primer segmento bajo la raíz de un preset. */
const LAYER_BY_DIR: Record<string, ModuleType | "app"> = {
	apps: "app",
	services: "service",
	providers: "provider",
	utilities: "utility",
};

/**
 * Vigila la raíz de UN preset (recursivo) y enruta los `index.<ext>` de sus capas.
 * Se vigila el topic completo — y no cada capa por separado — porque chokidar no
 * levanta directorios que no existían al montar el watcher (un preset clonándose
 * crea `services/`, `apps/`, ... DESPUÉS de que aparece el topic).
 */
export function watchPresetTopic(
	topicPath: string,
	fileExtension: string,
	handlersFor: (layer: ModuleType | "app") => LayerEventHandlers,
	opts: WatchTreeOptions
): ReturnType<typeof chokidar.watch> {
	const indexName = `index${fileExtension}`;
	const watcher = chokidar.watch(topicPath, {
		ignoreInitial: opts.ignoreInitial ?? true,
		ignored: isIgnoredTreePath,
		depth: WATCH_DEPTH,
		awaitWriteFinish: WRITE_FINISH,
	});
	const layerOf = (p: string): ModuleType | "app" | null => {
		const [first] = path.relative(topicPath, p).split(path.sep);
		return LAYER_BY_DIR[first] ?? null;
	};
	const relevant = (p: string) => path.basename(p) === indexName && layerOf(p) !== null;
	routeIndexEvents(watcher, relevant, (p) => {
		const layer = layerOf(p);
		return layer ? handlersFor(layer) : null;
	}, opts.isStartingUp);
	// Se devuelve para que `ConfigWatcher` cuelgue de él los configs de las apps del preset.
	return watcher;
}

/**
 * Vigila la raíz de `presets/` para autodetectar presets agregados en runtime
 * (git clone / copia). Emite el path del topic nuevo; el kernel monta su watcher
 * de topic (cuyos módulos quedarán PENDIENTES, nunca autoejecutados).
 */
export function watchPresetsRoot(presetsPath: string, isStartingUp: () => boolean, onNewTopic: (topicPath: string) => void): void {
	const watcher = chokidar.watch(presetsPath, {
		ignoreInitial: true,
		depth: 0,
		ignored: (p) => path.basename(p).startsWith("."),
	});
	watcher.on("addDir", (p) => {
		if (isStartingUp()) return;
		if (path.dirname(p) !== presetsPath) return;
		onNewTopic(p);
	});
}
