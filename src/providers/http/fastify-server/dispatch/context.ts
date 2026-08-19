import type { FastifyRequest, FastifyReply } from "fastify";
import type { ILogger } from "../../../../interfaces/utils/ILogger.js";
import type { HostRegistry } from "../routing/host-registry.js";
import type { GlobalRouteTable } from "../routing/global-routes.js";
import type { StaticStore } from "../static/static-store.js";

/** Lo que el manejo de una request necesita del provider. Lo arma `FastifyServerProvider`. */
export interface StaticDispatchContext {
	logger: ILogger;
	isDev: boolean;
	hosts: HostRegistry;
	routes: GlobalRouteTable;
	statics: StaticStore;
	/** Desvía la request a otro nodo. `false` = no hay gateway instalado o no la tomó. */
	tryForward: (request: FastifyRequest, reply: FastifyReply) => Promise<boolean>;
}
