import type { ILogger } from "../../../../interfaces/utils/ILogger.js";
import type { HttpHandler } from "../../../../interfaces/modules/providers/IHttpServer.js";
import type { FastifyHandler, GlobalRoute } from "../types.js";
import { normalizeHandler } from "./handler-adapter.js";
import { matchPath, routeSpecificity } from "./path-match.js";

/** Tabla de rutas globales (las que atienden en cualquier host), ordenada por especificidad. */
export class GlobalRouteTable {
	readonly #routes: GlobalRoute[] = [];

	constructor(private readonly logger: ILogger) {}

	register(method: string, path: string, handler: HttpHandler, owner?: string): void {
		const upperMethod = method.toUpperCase();

		// Reemplazo en el lugar si ya existe `method+path`: con un push incondicional, tras un
		// hot-reload el matcher (primera coincidencia) seguiría usando el wrapper de la instancia
		// vieja y la tabla crecería sin techo.
		const existing = this.#routes.findIndex((r) => r.method === upperMethod && r.path === path);
		const route: GlobalRoute = { method: upperMethod, path, handler: normalizeHandler(handler), specificity: routeSpecificity(path), owner };
		if (existing >= 0) {
			const previous = this.#routes[existing];
			this.#routes[existing] = route;
			this.logger.logDebug(`Ruta global reemplazada: ${upperMethod} ${path}` + (previous.owner ? ` (owner previo: ${previous.owner})` : ""));
		} else {
			this.#routes.push(route);
			this.logger.logDebug(`Ruta global registrada: ${upperMethod} ${path}${owner ? ` [${owner}]` : ""}`);
		}
		// Mantener invariante: tabla ordenada por especificidad descendente para
		// que el matcher (orden de iteración) priorice rutas estáticas.
		this.#routes.sort((a, b) => b.specificity - a.specificity);
	}

	/** Primera ruta que atiende `method urlPath`, con sus parámetros, o `null`. */
	find(method: string, urlPath: string): { handler: FastifyHandler; params: Record<string, string> } | null {
		for (const route of this.#routes) {
			if (route.method !== method.toUpperCase()) continue;
			const result = matchPath(route.path, urlPath);
			if (result.matched) return { handler: route.handler, params: result.params };
		}
		return null;
	}

	has(method: string, path: string): boolean {
		const upper = method.toUpperCase();
		return this.#routes.some((route) => route.method === upper && matchPath(route.path, path).matched);
	}

	/** Poda las rutas de un owner. Devuelve cuántas retiró. */
	removeByOwner(owner: string): number {
		const before = this.#routes.length;
		for (let i = this.#routes.length - 1; i >= 0; i--) {
			if (this.#routes[i].owner === owner) this.#routes.splice(i, 1);
		}
		return before - this.#routes.length;
	}

	get size(): number {
		return this.#routes.length;
	}
}
