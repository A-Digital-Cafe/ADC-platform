/**
 * Mantiene los mapeos filePath/configPath → instanceName.
 * Expone vistas de solo lectura para consumidores externos (kernel, watcher).
 * Mutación restringida a esta clase y a quienes la posean como dependencia interna.
 */
export class AppInstanceTracker {
	readonly #filePathToInstance = new Map<string, string>();
	readonly #configPathToInstance = new Map<string, string>();

	get appFilePaths(): ReadonlyMap<string, string> {
		return this.#filePathToInstance;
	}

	get appConfigFilePaths(): ReadonlyMap<string, string> {
		return this.#configPathToInstance;
	}

	registerInstance(filePath: string, instanceName: string, configPath?: string): void {
		this.#filePathToInstance.set(`${filePath}:${instanceName}`, instanceName);
		if (configPath) this.#configPathToInstance.set(configPath, instanceName);
	}

	getInstanceByConfigPath(configPath: string): string | undefined {
		return this.#configPathToInstance.get(configPath);
	}

	findConfigPathByInstance(instanceName: string): string | undefined {
		for (const [configPath, name] of this.#configPathToInstance) {
			if (name === instanceName) return configPath;
		}
		return undefined;
	}

	findFileKeysByPrefix(filePath: string): string[] {
		const keys: string[] = [];
		for (const key of this.#filePathToInstance.keys()) {
			if (key.startsWith(filePath)) keys.push(key);
		}
		return keys;
	}

	getInstanceByFileKey(key: string): string | undefined {
		return this.#filePathToInstance.get(key);
	}

	removeByFileKey(key: string): void {
		this.#filePathToInstance.delete(key);
	}

	removeConfigPath(configPath: string): void {
		this.#configPathToInstance.delete(configPath);
	}

	removeAllByInstance(instanceName: string): void {
		for (const [key, value] of this.#filePathToInstance) {
			if (value === instanceName) this.#filePathToInstance.delete(key);
		}
		for (const [cfg, value] of this.#configPathToInstance) {
			if (value === instanceName) this.#configPathToInstance.delete(cfg);
		}
	}

	removeFileKeysByInstance(instanceName: string): void {
		for (const [key, value] of this.#filePathToInstance) {
			if (value === instanceName) this.#filePathToInstance.delete(key);
		}
	}
}
