import { FederatedRouter } from "./federated-router.js";

export interface RouteDefinition {
	module: string;
	path?: string;
	subdomain?: string;
}

class Router {
	private onRouteChange: ((path: string) => void) | null = null;
	private popstateListener: (() => void) | null = null;
	private baseDomain: string | null = null;
	readonly federated = new FederatedRouter((p) => this.navigate(p));

	navigate(path: string) {
		if (globalThis.location?.pathname === path) {
			return;
		}

		globalThis.history?.pushState({}, "", path);
		if (this.onRouteChange) {
			this.onRouteChange(path);
		}
	}

	setOnRouteChange(callback: (path: string) => void) {
		this.onRouteChange = callback;

		if (!this.popstateListener) {
			this.popstateListener = () => {
				if (this.onRouteChange) {
					this.onRouteChange(globalThis.location?.pathname ?? "");
				}
			};
			globalThis.addEventListener("popstate", this.popstateListener);
		}

		return () => {
			if (this.popstateListener) {
				globalThis.removeEventListener("popstate", this.popstateListener);
				this.popstateListener = null;
			}
		};
	}

	getCurrentPath(): string {
		return globalThis.location?.pathname ?? "";
	}

	setBaseDomain(domain: string) {
		this.baseDomain = domain;
	}

	getSubdomain(): string | null {
		const hostname = globalThis.location?.hostname;

		if (hostname === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
			return null;
		}

		const base = this.baseDomain || this.#inferBaseDomain(hostname);
		if (!base || hostname === base) {
			return null;
		}

		const suffix = "." + base;
		if (hostname.endsWith(suffix)) {
			return hostname.slice(0, -suffix.length);
		}

		return null;
	}

	#inferBaseDomain(hostname: string): string {
		const parts = hostname.split(".");
		if (parts.length <= 2) {
			return hostname;
		}
		return parts.slice(-2).join(".");
	}

	resolveModule(routes: RouteDefinition[]): string | null {
		const subdomain = this.getSubdomain();
		const path = this.getCurrentPath();

		if (subdomain) {
			const subdomainRoute = routes.find((r) => r.subdomain === subdomain);
			if (subdomainRoute) {
				return subdomainRoute.module;
			}
		}

		const pathRoute = routes.find((r) => r.path === path);
		if (pathRoute) {
			return pathRoute.module;
		}

		const defaultRoute = routes.find((r) => r.path === "/");
		return defaultRoute?.module || null;
	}
}

export const router = new Router();
