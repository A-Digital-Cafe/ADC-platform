interface FederatedRoute {
	/** App identifier */
	id: string;
	/** Paths that belong to this app (matched by prefix) */
	paths: string[];
	/** Full URL for subdomain/port navigation */
	url: string;
	/** Optional: Module Federation config for inline loading instead of navigation */
	federation?: {
		remoteEntryUrl: string;
		remoteName: string;
		scope: string;
		framework: string;
	};
}

/**
 * Manages federated app routing — resolving, storing and navigating to federated apps.
 */
export class FederatedRouter {
	#routes: FederatedRoute[] = [];
	readonly #navigate: (path: string) => void;

	constructor(navigate: (path: string) => void) {
		this.#navigate = navigate;
	}

	/** Register routes for federated apps */
	setRoutes(routes: FederatedRoute[]) {
		this.#routes = routes;
	}

	/** Get all registered federated routes */
	getRoutes(): FederatedRoute[] {
		return this.#routes;
	}

	/** Find a federated route by app id */
	findRoute(appId: string): FederatedRoute | undefined {
		return this.#routes.find((r) => r.id === appId);
	}

	/** Find the federated route matching the given path */
	resolve(path: string): FederatedRoute | null {
		return this.#routes.find((r) => r.paths.some((p) => path === p || (p !== "/" && path.startsWith(p + "/")))) || null;
	}

	/**
	 * Navigate to a federated app — either by changing subdomain/port (default)
	 * or by resolving inline via Module Federation when `useFederation` is true.
	 *
	 * Returns the matched FederatedRoute if federation is requested and available,
	 * or null if navigation was handled by URL redirect.
	 */
	navigateToApp(appId: string, options?: { useFederation?: boolean; path?: string }): FederatedRoute | null {
		const route = this.findRoute(appId);
		if (!route) return null;

		const targetPath = options?.path || route.paths[0] || "/";

		if (options?.useFederation && route.federation) {
			this.#navigate(targetPath);
			return route;
		}

		globalThis.location.href = route.url + targetPath;
		return null;
	}
}
