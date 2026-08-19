import type { ILogger } from "../../../../../interfaces/utils/ILogger.js";
import type { ILangManagerService } from "../../../LangManagerService/types.js";
import type FastifyServerProvider from "../../../../../providers/http/fastify-server/index.js";
import type { ImportMap } from "../../../../../interfaces/modules/IUIModule.js";
import type { ModuleRegistry } from "../registry/module-registry.js";
import type { LoadSemaphore } from "../../../../../utils/system/LoadSemaphore.ts";
import type { ISEOService } from "../../../../../common/types/SEO/Service.js";
import type { ISessionVerifier } from "@common/types/identity/SessionVerifier.ts";

/** Ver {@link UIFederationContext.deferredBuilds}. */
interface DeferredBuildPolicy {
	/**
	 * Módulos cuyo build NO puede diferirse porque alguien espera su `buildStatus`: UI libraries,
	 * remotes y lo nombrado en un `uiDependencies` ajeno. El resto son hojas.
	 */
	observed: ReadonlySet<string>;
	/** Registra el build diferido para que el kernel lo drene antes de dar el boot por hecho. */
	track: (pending: Promise<void>) => void;
}

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
	/** Cota de bundlers concurrentes; ver `UIFederationService.#buildGate`. */
	buildGate: LoadSemaphore;
	/**
	 * Diferimiento de builds durante el arranque. `null` fuera de él —recargas, deploys,
	 * `rebuildModule`—, donde el llamador espera que al resolver la promesa el módulo esté listo.
	 */
	deferredBuilds: DeferredBuildPolicy | null;
	logger: ILogger;
	port: number;
	uiOutputBaseDir: string;
	isDevelopment: boolean;
	/** Lookup soft de SEOService. Devuelve `null` si aún no está registrado. */
	getSEOService: () => ISEOService | null;
	/**
	 * Lookup soft del verificador de sesión, para el gate de `uiModule.access`. Se resuelve por
	 * request (no al arrancar): SessionManagerService es una dependencia opcional y puede
	 * reiniciarse, y una referencia cacheada en el `start()` quedaría apuntando a la instancia
	 * muerta. `null` = no hay quien autentique, y el gate cierra.
	 */
	getSessionVerifier: () => ISessionVerifier | null;
}

export const DEFAULT_NAMESPACE = "default";
