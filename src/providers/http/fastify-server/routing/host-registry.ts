import type { ILogger } from "../../../../interfaces/utils/ILogger.js";
import type { HostOptions, HttpHandler } from "../../../../interfaces/modules/providers/IHttpServer.js";
import type { OwnedHostRoute, RegisteredHost } from "../types.js";
import { calculatePriority, hostPatternToRegex } from "./host-pattern.js";
import { normalizeHandler } from "./handler-adapter.js";
import { routeSpecificity } from "./path-match.js";

/** Tabla de hosts virtuales: patrones, sus rutas propias y el modo mantenimiento. */
export class HostRegistry {
	readonly #hosts = new Map<string, RegisteredHost>();
	/** Hosts en modo mantenimiento: patrón → mensaje. Sirven 503 en vez de la app. */
	readonly #maintenance = new Map<string, string>();
	/**
	 * Índice lateral de rutas de host por owner. Las rutas de host viven en `RegisteredHost.routes`
	 * (path → handler, sin dueño); este índice permite que `removeRoutesByOwner` también las pode
	 * sin cambiar la forma del map que recorre el matcher.
	 */
	readonly #ownedRoutes: OwnedHostRoute[] = [];
	#defaultHost: RegisteredHost | null = null;

	constructor(private readonly logger: ILogger) {}

	register(hostPattern: string, directory: string, options: HostOptions = {}): void {
		const priority = calculatePriority(hostPattern, options.priority);

		// Las rutas del host SOBREVIVEN a un re-registro. Registrar el mismo patrón otra vez es
		// normal —el drenaje de builds diferidos, un `rebuildModule`, un deploy git, un `enable()`—
		// y armar el objeto de cero descartaba en silencio todo lo que se hubiera registrado contra
		// ese patrón: `/sitemap.xml`, `/llms.txt`, `/_og/:file`. Peor todavía cuando el orden es el
		// inverso, que es el habitual con builds diferidos: `registerRoute` crea el host vacío, la
		// app registra su ruta, y el `register` posterior la borraba. El síntoma es que la ruta
		// responde el `index.html` del host, sin ningún error en el log.
		const previousRoutes = this.#hosts.get(hostPattern)?.routes;

		const host: RegisteredHost = {
			pattern: hostPattern,
			regex: hostPatternToRegex(hostPattern),
			directory,
			options: { spaFallback: true, ...options },
			priority,
			routes: previousRoutes ?? new Map(),
		};
		this.#hosts.set(hostPattern, host);

		// Si es un comodín genérico, usarlo como default
		if (hostPattern === "*" || hostPattern === "*.*") this.#defaultHost = host;

		this.logger.logDebug(`Host registrado: ${hostPattern} -> ${directory} (priority: ${priority})`);
	}

	registerRoute(hostPattern: string, method: string, path: string, handler: HttpHandler, owner?: string): void {
		if (!this.#hosts.has(hostPattern)) this.register(hostPattern, "", { spaFallback: false });
		const host = this.#hosts.get(hostPattern)!;

		const methodUpper = method.toUpperCase();
		if (!host.routes.has(methodUpper)) host.routes.set(methodUpper, new Map());

		const methodMap = host.routes.get(methodUpper)!;
		methodMap.set(path, normalizeHandler(handler));
		if (owner && !this.#ownedRoutes.some((r) => r.owner === owner && r.hostPattern === hostPattern && r.method === methodUpper && r.path === path)) {
			this.#ownedRoutes.push({ owner, hostPattern, method: methodUpper, path });
		}
		// Reordenar el Map por especificidad descendente para que rutas
		// estáticas (e.g. `/x/draft`) ganen frente a paramétricas (`/x/:id`).
		const sorted = Array.from(methodMap.entries()).sort(([a], [b]) => routeSpecificity(b) - routeSpecificity(a));
		host.routes.set(methodUpper, new Map(sorted));
		this.logger.logDebug(`Ruta de host registrada: ${hostPattern} ${methodUpper} ${path}`);
	}

	/** Host que atiende `hostname` (el más específico primero), o el comodín por defecto. */
	match(hostname: string): RegisteredHost | null {
		const sortedHosts = Array.from(this.#hosts.values()).sort((a, b) => b.priority - a.priority);
		for (const host of sortedHosts) {
			if (host.regex.test(hostname)) return host;
		}
		return this.#defaultHost;
	}

	/** Poda las rutas de host de un owner. Devuelve cuántas retiró. */
	removeRoutesByOwner(owner: string): number {
		let removed = 0;
		for (let i = this.#ownedRoutes.length - 1; i >= 0; i--) {
			const entry = this.#ownedRoutes[i];
			if (entry.owner !== owner) continue;
			this.#ownedRoutes.splice(i, 1);
			if (this.#hosts.get(entry.hostPattern)?.routes.get(entry.method)?.delete(entry.path)) removed++;
		}
		return removed;
	}

	setMaintenance(hostPattern: string, on: boolean, message?: string): void {
		if (on) this.#maintenance.set(hostPattern, message || "Esta aplicación no está disponible temporalmente.");
		else this.#maintenance.delete(hostPattern);
		this.logger.logDebug(`Host ${hostPattern} ${on ? "en mantenimiento (503)" : "operativo"}`);
	}

	/** Mensaje de mantenimiento del host, o `undefined` si está operativo. */
	maintenanceMessage(hostPattern: string): string | undefined {
		return this.#maintenance.get(hostPattern);
	}

	patterns(): string[] {
		return Array.from(this.#hosts.keys());
	}

	get size(): number {
		return this.#hosts.size;
	}
}
