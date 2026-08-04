import type { AppLoadInfo } from "./AppConfigReader.js";

/**
 * Allowlist de CARGA de apps (`ADC_LOAD_APPS`).
 *
 * `ADC_UI_APPS` acota qué módulos UI se **compilan**; las apps fuera de esa lista se cargan
 * y registran igual, así que sigue pagándose su arranque, sus providers y sus conexiones.
 * Esto es el otro nivel: las apps fuera de `ADC_LOAD_APPS` ni se cargan.
 *
 * Dos reglas hacen que sea usable en vez de un pie en el que dispararse:
 *
 *  1. **Cierre transitivo de `uiDependencies`.** Pedir `adc-drive` sin arrastrar lo que
 *     declara como dependencia UI dejaría al host esperando remotes que nunca se registran,
 *     y el timeout de `waitForDeclaredRemotes` (30 s) convertiría el boot dirigido en uno
 *     más lento que el completo.
 *  2. **Las UI libraries siempre entran.** Son la dependencia compartida contra la que
 *     bundlean todos los hosts; omitirlas deja a la app elegida compilando contra un
 *     `init.js`/`styles.css` de otra corrida. Es la misma regla que ya aplica el gate de
 *     build.
 *
 * Lo que queda afuera se le declara al orquestador como **dormido**
 * (`ModuleOrchestrator.setDormantApps`): configurado-pero-no-cargado es indistinguible de
 * "se cayó", y sin ese estado la status page pública se pondría roja tres minutos después
 * de cada boot dirigido.
 */

export interface LoadAllowlist {
	/** Directorios de app a cargar. Vacío ⇒ no hay allowlist (se cargan todas). */
	load: Set<string>;
	/** Directorios de app excluidos de este arranque (dormidos). */
	dormant: Set<string>;
	/** Nombres pedidos que no matchearon ninguna app (typo en la env var). */
	unknown: string[];
}

/** Sin allowlist: todo se carga y nada queda dormido. */
const LOAD_EVERYTHING: LoadAllowlist = { load: new Set(), dormant: new Set(), unknown: [] };

/** Parsea `ADC_LOAD_APPS=adc-home,adc-drive`. Vacía/ausente = sin allowlist. */
export function parseLoadAppsEnv(raw: string | undefined): string[] {
	return (raw ?? "")
		.split(",")
		.map((name) => name.trim())
		.filter(Boolean);
}

/**
 * Resuelve qué directorios de app cargar.
 *
 * `apps` son TODAS las apps candidatas de todas las capas (`src/apps` + `presets/<topic>/apps`);
 * pasar sólo una capa dejaría fuera del cierre transitivo a las dependencias de otro repo,
 * que es el caso normal (`adc-drive` depende de `adc-ui-library`, que vive en `src`).
 */
export function resolveLoadAllowlist(apps: AppLoadInfo[], requested: string[]): LoadAllowlist {
	if (requested.length === 0) return LOAD_EVERYTHING;

	// Una app se puede pedir por su nombre de módulo UI o por su directorio: son distintos
	// (`00-adc-ui-library` ↔ `adc-ui-library`) y quien escribe la env var usa el que conoce.
	const byName = new Map<string, AppLoadInfo>();
	for (const app of apps) {
		byName.set(app.name, app);
		byName.set(app.dirName, app);
	}

	const load = new Set<string>();
	const unknown: string[] = [];
	const queue: AppLoadInfo[] = [];

	const enqueue = (app: AppLoadInfo): void => {
		if (load.has(app.dirName)) return;
		load.add(app.dirName);
		queue.push(app);
	};

	// Las UI libraries entran siempre, aunque nadie las haya pedido ni las declare.
	for (const app of apps) if (app.isUILib) enqueue(app);

	for (const name of requested) {
		const app = byName.get(name);
		if (app) enqueue(app);
		else unknown.push(name);
	}

	// Cierre transitivo sobre `uiDependencies` (BFS; el `Set` corta los ciclos).
	while (queue.length > 0) {
		const current = queue.shift()!;
		for (const dep of current.dependencies) {
			const depApp = byName.get(dep);
			// Una dependencia que no resuelve a ninguna app no es un error acá: `uiDependencies`
			// admite nombres de módulos que no son apps de este árbol.
			if (depApp) enqueue(depApp);
		}
	}

	const dormant = new Set(apps.filter((app) => !load.has(app.dirName)).map((app) => app.dirName));
	return { load, dormant, unknown };
}
