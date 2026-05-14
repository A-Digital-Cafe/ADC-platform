import type { ILogger } from "../../../../../interfaces/utils/ILogger.js";
import type { ILangManagerService } from "../../../LangManagerService/types.js";
import type FastifyServerProvider from "../../../../../providers/http/fastify-server/index.js";
import type { ImportMap } from "../../../../../interfaces/modules/IUIModule.js";
import type { ModuleRegistry } from "../registry/module-registry.js";

export interface HostRegistryEntry {
	namespace: string;
	moduleName: string;
	directory: string;
}

/**
 * Contexto compartido entre el servicio y sus helpers.
 * Encapsula el estado y dependencias inyectables de UIFederationService.
 */
export interface UIFederationContext {
	registry: ModuleRegistry;
	importMaps: Map<string, ImportMap>;
	watchBuilds: Map<string, any>;
	hostRegistry: Map<string, HostRegistryEntry>;
	httpProvider: FastifyServerProvider | null;
	langManager: ILangManagerService | null;
	logger: ILogger;
	port: number;
	uiOutputBaseDir: string;
	isDevelopment: boolean;
}

export const DEFAULT_NAMESPACE = "default";
