import * as fs from "node:fs/promises";
import * as path from "node:path";
import { safeParseJson } from "@common/utils/json-schema.ts";
import { isInsideBase } from "@common/utils/path-containment.ts";
import { moduleConfigCheck } from "@common/schemas/module-config.ts";
import type { ModuleType } from "../../utils/registry/ModuleRegistry.js";

type Layer = ModuleType | "app";

interface GraphNode {
	layer: Layer;
	/** Nombre canónico (campo `name` del config, o basename de la carpeta para apps). */
	name: string;
	dir: string;
	/**
	 * Nombre amigable (grupo de status público). Apps lo declaran en `uiModule.uiName`,
	 * el resto de capas en el `uiName` de nivel superior. `undefined` ⇒ módulo interno
	 * (no se agrupa ni se muestra en la status page).
	 */
	uiName?: string;
}

/**
 * Podados del recorrido: dependencias y artefactos de build. Sin esto, el fallback a
 * `package.json` convertiría cada paquete npm bajo `node_modules` en un "módulo".
 */
const SKIPPED_DIRS = new Set(["node_modules", ".git", "dist", "temp", "www", ".stencil", "coverage"]);

const LAYER_FIELD: Record<Exclude<Layer, "app">, "providers" | "utilities" | "services"> = {
	provider: "providers",
	utility: "utilities",
	service: "services",
};

/**
 * Grafo de dependencias derivado de los `config.json` en disco (src + presets),
 * NO del tracking en runtime (que es incompleto: los kernel services registran sus
 * providers con `appName=null`, así que sus aristas no quedan en el registry).
 *
 * Resuelve por **nombre** (con normalización de basename: `object/mongo` ↔ `mongo`),
 * que es como los config referencian las dependencias. Cubre apps + services +
 * providers + utilities, incluyendo kernel services.
 */
export class DependencyGraph {
	/** consumidor(`layer:name`) → set de dependencias(`layer:name`). */
	readonly #forward = new Map<string, Set<string>>();
	/**
	 * dependencia(`layer:name` y `layer:basename`) → mapa de consumidores(`layer:name`) →
	 * `optional` (true sólo si TODAS las declaraciones del consumidor son opcionales:
	 * "required wins").
	 */
	readonly #reverse = new Map<string, Map<string, boolean>>();
	readonly #nodes = new Map<string, GraphNode>();

	#key(layer: Layer, name: string): string {
		return `${layer}:${name}`;
	}

	#basename(name: string): string {
		return name.includes("/") ? name.split("/").pop()! : name;
	}

	#addReverse(depLayer: Exclude<Layer, "app">, depName: string, consumerKey: string, optional: boolean): void {
		for (const variant of new Set([depName, this.#basename(depName)])) {
			const k = this.#key(depLayer, variant);
			let consumers = this.#reverse.get(k);
			if (!consumers) this.#reverse.set(k, (consumers = new Map()));
			// required wins: una arista es opcional sólo si nunca se declaró como requerida.
			const prev = consumers.get(consumerKey);
			consumers.set(consumerKey, prev === undefined ? optional : prev && optional);
		}
	}

	/** Reconstruye el grafo escaneando src + presets. Idempotente. */
	async build(srcPath: string, presetsPath: string): Promise<void> {
		this.#forward.clear();
		this.#reverse.clear();
		this.#nodes.clear();

		const roots: string[] = [srcPath];
		try {
			for (const entry of await fs.readdir(presetsPath, { withFileTypes: true })) {
				if (entry.isDirectory() && !entry.name.startsWith(".")) roots.push(path.join(presetsPath, entry.name));
			}
		} catch {
			/* sin presets */
		}

		for (const root of roots) {
			await this.#scanLayer(path.join(root, "apps"), "app");
			await this.#scanLayer(path.join(root, "services"), "service");
			await this.#scanLayer(path.join(root, "providers"), "provider");
			await this.#scanLayer(path.join(root, "utilities"), "utility");
		}
	}

	/** Recorre un directorio de capa buscando módulos (carpetas con config.json/default.json/package.json). */
	async #scanLayer(layerDir: string, layer: Layer): Promise<void> {
		if (SKIPPED_DIRS.has(path.basename(layerDir))) return;
		let entries: import("node:fs").Dirent[];
		try {
			entries = await fs.readdir(layerDir, { withFileTypes: true });
		} catch {
			return;
		}
		const config = await this.#readModuleConfig(layerDir);
		if (config) {
			await this.#addModule(layerDir, layer, config);
			return;
		}
		// La mayoría de providers y utilities NO trae config propio: la declara quien los consume
		// (`providers: [{ name: "mongo", custom: {...} }]`), y sin esto quedarían fuera del grafo.
		// Misma regla de "raíz de módulo" que usa ModuleDetector: alcanza con package.json.
		if (layer !== "app" && entries.some((e) => e.isFile() && e.name === "package.json")) {
			await this.#addModule(layerDir, layer, {});
			return;
		}
		for (const entry of entries) {
			if (entry.isDirectory()) await this.#scanLayer(path.join(layerDir, entry.name), layer);
		}
	}

	async #readModuleConfig(dir: string): Promise<Record<string, any> | null> {
		for (const file of ["config.json", "default.json"]) {
			try {
				const cfg = safeParseJson(await fs.readFile(path.join(dir, file), "utf-8"), moduleConfigCheck);
				if (cfg) return cfg;
			} catch {
				/* siguiente */
			}
		}
		return null;
	}

	async #addModule(dir: string, layer: Layer, config: Record<string, any>): Promise<void> {
		const name = (layer === "app" ? undefined : config.name) || path.basename(dir);
		const consumerKey = this.#key(layer, name);
		// Apps declaran el nombre amigable bajo `uiModule`; el resto en la raíz del config.
		const uiName = layer === "app" ? config.uiModule?.uiName : config.uiName;
		this.#nodes.set(consumerKey, { layer, name, dir, uiName: typeof uiName === "string" && uiName ? uiName : undefined });

		const deps = new Set<string>();
		for (const depLayer of ["provider", "utility", "service"] as const) {
			const list: Array<{ name?: string; optional?: boolean }> = config[LAYER_FIELD[depLayer]] ?? [];
			for (const dep of list) {
				if (!dep?.name) continue;
				deps.add(this.#key(depLayer, dep.name));
				this.#addReverse(depLayer, dep.name, consumerKey, !!dep.optional);
			}
		}
		this.#forward.set(consumerKey, deps);
	}

	/**
	 * Consumidores DIRECTOS de un módulo, separados por capa. Resuelve por nombre+basename.
	 * Con `includeOptional: false` se excluyen los consumidores cuya dependencia sobre este
	 * módulo es opcional (no deben cascadearse al detenerlo).
	 */
	directDependents(
		layer: Exclude<Layer, "app">,
		name: string,
		opts: { includeOptional?: boolean } = {}
	): { apps: string[]; services: string[] } {
		const includeOptional = opts.includeOptional ?? true;
		const consumers = new Set<string>();
		for (const variant of new Set([name, this.#basename(name)])) {
			for (const [consumerKey, optional] of this.#reverse.get(this.#key(layer, variant)) ?? []) {
				if (!includeOptional && optional) continue;
				consumers.add(consumerKey);
			}
		}
		const apps: string[] = [];
		const services: string[] = [];
		for (const c of consumers) {
			const node = this.#nodes.get(c);
			if (!node) continue;
			if (node.layer === "app") apps.push(node.name);
			else if (node.layer === "service") services.push(node.name);
		}
		return { apps, services };
	}

	/**
	 * Todos los nombres declarados en una capa, estén cargados o no: el grafo sale del escaneo de
	 * configs en disco, así que ve también lo que este arranque no levantó. `friendlyGroups()` no
	 * sirve para eso — deja fuera a los módulos sin `uiName`.
	 */
	names(layer: Layer): string[] {
		const out: string[] = [];
		for (const node of this.#nodes.values()) if (node.layer === layer) out.push(node.name);
		return out;
	}

	/** Nombre amigable declarado por un módulo (`uiName`), o `undefined` si es interno. */
	uiNameOf(layer: Layer, name: string): string | undefined {
		return this.#nodes.get(this.#key(layer, name))?.uiName;
	}

	/**
	 * Nombres de módulos de una capa cuyo directorio vive bajo `baseDir` (un target de git: el `src`
	 * del core o `presets/<nombre>`). Sale del escaneo de configs en disco, la única fuente que
	 * conoce la ubicación de TODOS los módulos: el registry sólo guarda el path de los cargados por
	 * `registerByPath`, no de los que levantó el arranque.
	 */
	namesUnderPath(layer: Layer, baseDir: string): string[] {
		const out: string[] = [];
		for (const node of this.#nodes.values()) {
			if (node.layer === layer && isInsideBase(baseDir, node.dir)) out.push(node.name);
		}
		return out;
	}

	/**
	 * Agrupa apps + services por su `uiName` (grupos de la status page pública). Sólo
	 * incluye nodos con `uiName` declarado; providers/utilities quedan fuera. Las apps
	 * aportan al frente; los services, al back.
	 */
	friendlyGroups(): Map<string, { apps: string[]; services: string[] }> {
		const groups = new Map<string, { apps: string[]; services: string[] }>();
		for (const node of this.#nodes.values()) {
			if (!node.uiName || (node.layer !== "app" && node.layer !== "service")) continue;
			let group = groups.get(node.uiName);
			if (!group) groups.set(node.uiName, (group = { apps: [], services: [] }));
			(node.layer === "app" ? group.apps : group.services).push(node.name);
		}
		return groups;
	}

	/** Dependencias declaradas por un servicio (para liberar providers exclusivos al detenerlo). */
	declaredDependencies(layer: Exclude<Layer, "app">, name: string): Array<{ layer: Exclude<Layer, "app">; name: string }> {
		const out: Array<{ layer: Exclude<Layer, "app">; name: string }> = [];
		const deps = this.#forward.get(this.#key(layer, name));
		if (!deps) return out;
		for (const dep of deps) {
			const [depLayer, ...rest] = dep.split(":");
			out.push({ layer: depLayer as Exclude<Layer, "app">, name: rest.join(":") });
		}
		return out;
	}
}
