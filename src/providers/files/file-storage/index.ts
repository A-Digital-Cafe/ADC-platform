import { IStorage } from "../../../interfaces/modules/providers/IStorage.js";
import { isInsideBase } from "@common/utils/path-containment.ts";
import { BaseProvider, ProviderType } from "../../BaseProvider.js";

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Buffer } from "node:buffer";

export default class FileStorageProvider extends BaseProvider implements IStorage {
	public readonly name = "file-storage-provider";
	public readonly type = ProviderType.STORAGE_PROVIDER;

	readonly #basePath: string = "./temp/file-storage"; // Valor por defecto
	#initialized: boolean = false;

	constructor(config?: Record<string, any>) {
		super();

		if (config?.basePath) this.#basePath = config.basePath;
	}

	#getKeyPath(key: string): string {
		// Usamos una extensión genérica. ¡Importante! Evitar 'path traversal'.
		const safeKey = path.basename(key);
		return path.join(this.#basePath, `${safeKey}.bin`);
	}

	async start(kernelKey: symbol): Promise<void> {
		await super.start(kernelKey);

		// Asegurarse de que el directorio de almacenamiento exista
		await this.#init();
	}

	async #init(): Promise<void> {
		if (this.#initialized) return;

		try {
			await fs.mkdir(this.#basePath, { recursive: true });
			this.#initialized = true;
		} catch (err: any) {
			this.logger.logError(`Error creating directory: ${err}`);
			throw err;
		}
	}

	async save(key: string, data: Buffer): Promise<void> {
		const filePath = this.#getKeyPath(key);
		this.logger.logDebug(`Saving ${data.byteLength} bytes to ${filePath}...`);
		await fs.writeFile(filePath, data);
	}

	async load(key: string): Promise<Buffer | null> {
		const filePath = this.#getKeyPath(key);
		try {
			const data = await fs.readFile(filePath);
			this.logger.logDebug(`Loading ${data.byteLength} bytes from ${filePath}...`);
			return data;
		} catch (err: any) {
			if (err.code === "ENOENT") {
				// ENOENT = Error NO ENTry (Archivo no encontrado)
				this.logger.logDebug(`File not found: ${key}`);
				return null;
			}
			// Otro error (ej. permisos)
			this.logger.logError(`Error loading ${key}: ${err}`);
			throw err;
		}
	}

	async delete(key: string): Promise<void> {
		const filePath = this.#getKeyPath(key);
		try {
			await fs.unlink(filePath);
			this.logger.logDebug(`Deleted file: ${key}`);
		} catch (err: any) {
			if (err.code === "ENOENT") {
				this.logger.logDebug(`File to delete not found: ${key}`);
				return; // No hacer nada si no existe
			}
			this.logger.logError(`Error deleting ${key}: ${err}`);
			throw err;
		}
	}

	async list(subPath?: string): Promise<string[]> {
		const dirPath = subPath ? path.resolve(this.#basePath, subPath) : path.resolve(this.#basePath);
		// `save`/`load`/`delete` se defienden con `basename`; el listado admite subdirectorios, así
		// que acá la defensa es la contención dentro de `#basePath`.
		if (!isInsideBase(this.#basePath, dirPath)) {
			this.logger.logError(`Listado fuera del almacenamiento: ${subPath}`);
			return [];
		}
		try {
			const files = await fs.readdir(dirPath);
			// Devolver solo los nombres de archivo sin la extensión .bin
			return files.map((file) => path.basename(file, ".bin"));
		} catch (err: any) {
			if (err.code === "ENOENT") return []; // Si el directorio no existe, no hay archivos

			this.logger.logError(`Error listing files in ${dirPath}: ${err}`);
			throw err;
		}
	}
}
