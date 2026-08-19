import type { FastifyRequest, FastifyReply } from "fastify";
import type { HostOptions } from "../../../interfaces/modules/providers/IHttpServer.js";

/** Firma nativa de fastify. Todo handler entrante se normaliza a ésta (ver `routing/handler-adapter.ts`). */
export type FastifyHandler = (req: FastifyRequest<any>, reply: FastifyReply<any>) => void | Promise<void>;

export interface RegisteredHost {
	pattern: string;
	regex: RegExp;
	directory: string;
	options: HostOptions;
	priority: number;
	routes: Map<string, Map<string, FastifyHandler>>;
}

export interface GlobalRoute {
	method: string;
	path: string;
	handler: FastifyHandler;
	/** Score de especificidad. Mayor = más específica. Se usa para ordenar la tabla de matching. */
	specificity: number;
	/**
	 * Módulo dueño de la ruta (`ownerName` del endpoint), si lo declaró. Permite podarla cuando el
	 * dueño se detiene: sin esto la tabla sólo crecía y el wrapper de una instancia ya destruida
	 * seguía atendiendo.
	 */
	owner?: string;
}

export interface PathMatchResult {
	matched: boolean;
	params: Record<string, string>;
}

/** Ruta de host registrada a nombre de un módulo, para poder podarla cuando ese módulo se detiene. */
export interface OwnedHostRoute {
	owner: string;
	hostPattern: string;
	method: string;
	path: string;
}
