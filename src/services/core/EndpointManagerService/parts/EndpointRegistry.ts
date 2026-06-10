import { ILogger } from "../../../../interfaces/utils/ILogger.js";
import type { RegisteredEndpoint, HttpMethod, EndpointConfig, EndpointHandler } from "../types.ts";

// Una configuración más específica para el registro, conteniendo solo lo necesario.
interface RegistryRegistrationConfig {
	method: HttpMethod;
	url: string;
	permissions: string[];
	options?: EndpointConfig["options"];
	instance: object;
	methodName: string;
	handler: EndpointHandler<any, any, any>;
	ownerName: string;
}

export class EndpointRegistry {
	private readonly logger: ILogger;

	constructor(logger: ILogger) {
		this.logger = logger;
	}

	/** Endpoints registrados indexados por ID */
	readonly #endpoints: Map<string, RegisteredEndpoint> = new Map();
	/** Índice de endpoints por owner para cleanup rápido */
	readonly #endpointsByOwner: Map<string, Set<string>> = new Map();
	/** Contador para generar IDs únicos */
	#idCounter = 0;

	/**
	 * Crea y almacena un nuevo endpoint.
	 * @param config La configuración del endpoint.
	 * @returns El objeto RegisteredEndpoint completo.
	 */
	public register(config: RegistryRegistrationConfig): RegisteredEndpoint {
		const id = `ep_${++this.#idCounter}_${config.ownerName}_${config.methodName}`;

		const endpoint: RegisteredEndpoint = {
			id,
			method: config.method,
			url: config.url,
			permissions: config.permissions,
			options: config.options,
			instance: config.instance,
			methodName: config.methodName,
			handler: config.handler,
			ownerName: config.ownerName,
		};

		this.#endpoints.set(id, endpoint);

		if (!this.#endpointsByOwner.has(config.ownerName)) this.#endpointsByOwner.set(config.ownerName, new Set());

		this.#endpointsByOwner.get(config.ownerName)!.add(id);

		return endpoint;
	}

	/**
	 * Elimina todos los endpoints asociados a un owner.
	 * @param ownerName El nombre del propietario.
	 * @returns El número de endpoints eliminados.
	 */
	public unregisterByOwner(ownerName: string): number {
		const endpointIds = this.#endpointsByOwner.get(ownerName);
		if (!endpointIds) return 0;

		let count = 0;
		for (const id of endpointIds) {
			if (this.#endpoints.delete(id)) count++;
		}

		this.#endpointsByOwner.delete(ownerName);
		this.logger.logDebug(`${count} endpoints desregistrados para owner: ${ownerName}`);
		return count;
	}

	/**
	 * Obtiene todos los endpoints registrados.
	 * @returns Un array de todos los endpoints.
	 */
	public getAll(): Array<{
		id: string;
		method: HttpMethod;
		url: string;
		permissions: string[];
		ownerName: string;
	}> {
		return Array.from(this.#endpoints.values()).map((ep) => ({
			id: ep.id,
			method: ep.method,
			url: ep.url,
			permissions: ep.permissions,
			ownerName: ep.ownerName,
		}));
	}

	/**
	 * Obtiene los endpoints completos (incluye options/methodName/handler).
	 * Uso interno del servicio (ej. generación del documento OpenAPI).
	 */
	public getAllFull(): RegisteredEndpoint[] {
		return Array.from(this.#endpoints.values());
	}

	/**
	 * Genera estadísticas sobre los endpoints registrados.
	 * @returns Un objeto con las estadísticas.
	 */
	public getStats(): {
		totalEndpoints: number;
		endpointsByOwner: Record<string, number>;
		publicEndpoints: number;
		protectedEndpoints: number;
	} {
		const endpointsByOwner: Record<string, number> = {};
		let publicEndpoints = 0;
		let protectedEndpoints = 0;

		for (const [owner, ids] of this.#endpointsByOwner) {
			endpointsByOwner[owner] = ids.size;
		}

		for (const ep of this.#endpoints.values()) {
			if (ep.permissions.length === 0) publicEndpoints++;
			else protectedEndpoints++;
		}

		return {
			totalEndpoints: this.#endpoints.size,
			endpointsByOwner,
			publicEndpoints,
			protectedEndpoints,
		};
	}

	// Limpia todos los registros de endpoints.
	public clear(): void {
		this.#endpoints.clear();
		this.#endpointsByOwner.clear();
	}
}
