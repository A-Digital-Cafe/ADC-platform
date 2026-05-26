import * as path from "node:path";
import { BaseService } from "../../BaseService.js";

import { IStorage } from "../../../interfaces/modules/providers/IStorage.js";
import { IFileAdapter } from "../../../interfaces/modules/utilities/adapters/IFIleAdapter.js";

/**
 * Interfaz que define las operaciones CRUD para archivos JSON
 */
export interface IJsonFileCrud {
	create<T>(key: string, data: T): Promise<void>;
	read<T>(key: string): Promise<T | null>;
	update<T>(key: string, data: T): Promise<void>;
	delete(key: string): Promise<void>;
	exists(key: string): Promise<boolean>;
	listFiles(subPath?: string): Promise<string[]>;
}

/**
 * Service que expone las operaciones CRUD para JSON usando módulos desacoplados
 * Extiende BaseService para heredar la lógica de carga de módulos
 */
export default class JsonFileCrudService extends BaseService implements IJsonFileCrud {
	public readonly name = "json-file-crud";

	private storage!: IStorage;
	private fileAdapter!: IFileAdapter<any>;

	#getFilePath(key: string): string {
		const safeKey = path.basename(key);
		return safeKey;
	}

	async start(kernelKey: symbol): Promise<void> {
		await super.start(kernelKey);

		// 1. Obtener la configuración para el provider de storage
		const storageProviderConfig = this.config?.providers?.find((p) => p.name === "file-storage" || p.type === "storage-provider")?.config;

		// 2. Obtener la instancia específica del storage (con el basePath correcto)
		this.storage = this.getMyProvider<IStorage>("storage-provider", storageProviderConfig);

		// 3. Repetir para el utility adaptador de archivos
		const fileAdapterConfig = this.config?.utilities?.find((m) => m.name === "json-file-adapter" || m.type === "json-file-adapter")?.config;

		this.fileAdapter = this.getMyUtility<IFileAdapter<any>>("json-file-adapter", fileAdapterConfig);

		this.logger.logOk("JsonFileCrudService iniciado");
	}

	async create<T>(key: string, data: T): Promise<void> {
		const filePath = this.#getFilePath(key);

		// Verificar si ya existe
		const exists = await this.storage.load(filePath);
		if (exists) {
			throw new Error(`[JsonFileCrud] El archivo '${key}' ya existe. Usa update() para modificarlo.`);
		}

		// Guardar usando el storage y el adaptador
		const buffer = await this.fileAdapter.toBuffer(data);
		await this.storage.save(filePath, buffer);
		this.logger.logOk(`[JsonFileCrud] Archivo creado: ${key}`);
	}

	async read<T>(key: string): Promise<T | null> {
		const filePath = this.#getFilePath(key);

		try {
			const buffer = await this.storage.load(filePath);
			if (!buffer) {
				this.logger.logDebug(`Archivo no disponible: ${key}`);
				return null;
			}
			const data = (await this.fileAdapter.fromBuffer(buffer)) as T;
			this.logger.logDebug(`Archivo leído: ${key}`);
			return data;
		} catch (err: any) {
			throw new Error(`[JsonFileCrud] Error al leer ${key}: ${err.message}`, { cause: err });
		}
	}

	async update<T>(key: string, data: T): Promise<void> {
		const filePath = this.#getFilePath(key);

		// Verificar que existe
		const exists = await this.storage.load(filePath);
		if (!exists) {
			throw new Error(`[JsonFileCrud] El archivo '${key}' no existe. Usa create() para crear uno nuevo.`);
		}

		// Actualizar archivo
		const buffer = await this.fileAdapter.toBuffer(data);
		await this.storage.save(filePath, buffer);
		this.logger.logDebug(`[JsonFileCrud] Archivo actualizado: ${key}`);
	}

	async delete(key: string): Promise<void> {
		const filePath = this.#getFilePath(key);
		await this.storage.delete(filePath);
		this.logger.logOk(`[JsonFileCrud] Archivo eliminado: ${key}`);
	}

	async exists(key: string): Promise<boolean> {
		try {
			const filePath = this.#getFilePath(key);
			const buffer = await this.storage.load(filePath);
			return buffer !== null;
		} catch {
			return false;
		}
	}

	async listFiles(subpath?: string): Promise<string[]> {
		this.logger.logDebug(`[JsonFileCrud] Listando archivos en ${subpath || "la raíz"}`);
		return this.storage.list(subpath);
	}
}
