import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ModuleType } from "../../utils/registry/ModuleRegistry.js";

type Layer = ModuleType | "app";

interface GraphNode {
	layer: Layer;
	/** Nombre canónico (campo `name` del config, o basename de la carpeta para apps). */
	name: string;
	dir: string;
}

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
	/** dependencia(`layer:name` y `layer:basename`) → set de consumidores(`layer:name`). */
	readonly #reverse = new Map<string, Set<string>>();
	readonly #nodes = new Map<string, GraphNode>();

	#key(layer: Layer, name: string): string {
		return `${layer}:${name}`;
	}

	#basename(name: string): string {
		return name.includes("/") ? name.split("/").pop()! : name;
	}

	#addReverse(depLayer: Exclude<Layer, "app">, depName: string, consumerKey: string): void {
		for (const variant of new Set([depName, this.#basename(depName)])) {
			const k = this.#key(depLayer, variant);
			let set = this.#reverse.get(k);
			if (!set) this.#reverse.set(k, (set = new Set()));
			set.add(consumerKey);
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

	/** Recorre un directorio de capa buscando módulos (carpetas con config.json/default.json). */
	async #scanLayer(layerDir: string, layer: Layer): Promise<void> {
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
		for (const entry of entries) {
			if (entry.isDirectory()) await this.#scanLayer(path.join(layerDir, entry.name), layer);
		}
	}

	async #readModuleConfig(dir: string): Promise<Record<string, any> | null> {
		for (const file of ["config.json", "default.json"]) {
			try {
				return JSON.parse(await fs.readFile(path.join(dir, file), "utf-8"));
			} catch {
				/* siguiente */
			}
		}
		return null;
	}

	async #addModule(dir: string, layer: Layer, config: Record<string, any>): Promise<void> {
		const name = (layer === "app" ? undefined : config.name) || path.basename(dir);
		const consumerKey = this.#key(layer, name);
		this.#nodes.set(consumerKey, { layer, name, dir });

		const deps = new Set<string>();
		for (const depLayer of ["provider", "utility", "service"] as const) {
			const list: Array<{ name?: string }> = config[LAYER_FIELD[depLayer]] ?? [];
			for (const dep of list) {
				if (!dep?.name) continue;
				deps.add(this.#key(depLayer, dep.name));
				this.#addReverse(depLayer, dep.name, consumerKey);
			}
		}
		this.#forward.set(consumerKey, deps);
	}

	/** Consumidores DIRECTOS de un módulo, separados por capa. Resuelve por nombre+basename. */
	directDependents(layer: Exclude<Layer, "app">, name: string): { apps: string[]; services: string[] } {
		const consumers = new Set<string>();
		for (const variant of new Set([name, this.#basename(name)])) {
			for (const c of this.#reverse.get(this.#key(layer, variant)) ?? []) consumers.add(c);
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
