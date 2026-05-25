import type { FastifyRequest, FastifyReply } from "fastify";
import { BaseService } from "../../BaseService.js";
import type FastifyServerProvider from "../../../providers/http/fastify-server/index.js";
import type {
	CachedRender,
	HostSEOState,
	PageMeta,
	RegisterPageMetaOptions,
	RegisterSitemapOptions,
	SitemapRegistration,
} from "./parts/types.js";
import { collectHosts } from "./parts/host-utils.js";
import { compileEntry, mergeDefaults } from "./parts/matcher.js";
import { serveSitemap, serveSitemapIndex } from "./parts/sitemap-handler.js";
import { HeadInjector } from "./parts/head-injector.js";

export type * from "./parts/types.js";

/**
 * SEOService: sitemap.xml por host + inyección on-the-fly de meta tags
 * sobre las respuestas HTML de cualquier host marcado vía
 * `UIFederationService` (uiModule.enableSEO=true).
 */
export default class SEOService extends BaseService {
	public readonly name = "SEOService";

	#fastify: FastifyServerProvider | null = null;
	#hookInstalled = false;
	#injector: HeadInjector | null = null;
	readonly #byHost = new Map<string, SitemapRegistration[]>();
	readonly #indexHosts = new Set<string>();
	readonly #seoByHost = new Map<string, HostSEOState>();
	readonly #renderCache = new Map<string, CachedRender>();

	async start(kernelKey: symbol): Promise<void> {
		await super.start(kernelKey);
	}

	/**
	 * Recibe el provider de fastify e instala el hook onSend.
	 * Debe llamarse antes de `fastify.listen()`. Idempotente.
	 */
	attachFastify(provider: FastifyServerProvider): void {
		if (this.#fastify) return;
		this.#fastify = provider;
		this.#installHook();
	}

	// ============ Sitemap ============

	registerOnSitemap(options: RegisterSitemapOptions): void {
		const hosts = collectHosts(options.hosting);
		if (!hosts.length) {
			this.logger.logDebug(`${options.appName}: sin hosting; sitemap omitido`);
			return;
		}
		if (!this.#fastify) {
			this.logger.logDebug(`${options.appName}: fastify-server no disponible; sitemap omitido`);
			return;
		}

		for (const host of hosts) {
			// Los hosts comodín (`*.dominio`) actúan como catch-all y no deben ser índices.
			const isIndex = !!options.isIndex && !host.startsWith("*.");
			if (isIndex) this.#indexHosts.add(host);

			let regs = this.#byHost.get(host);
			if (!regs) {
				regs = [];
				this.#byHost.set(host, regs);
				this.#registerHostSitemapRoutes(host);
			} else if (isIndex) {
				// Si pasa a ser índice tras un registro previo, asegurar la ruta de main.xml.
				this.#registerHostSitemapRoutes(host);
			}
			regs.push({ appName: options.appName, source: options.paths, appDir: options.appDir });
		}
	}

	#registerHostSitemapRoutes(host: string): void {
		if (!this.#fastify) return;
		this.#fastify.registerHostRoute(host, "GET", "/sitemap.xml", async (req: FastifyRequest, reply: FastifyReply) => {
			const regs = this.#byHost.get(host) ?? [];
			if (this.#indexHosts.has(host)) {
				await serveSitemapIndex(host, regs, this.#computeSiblingHosts(host), req, reply);
			} else {
				await serveSitemap(host, regs, req, reply, this.logger);
			}
		});
		// Ruta dedicada para las URLs propias del host (usada por hosts índice).
		this.#fastify.registerHostRoute(host, "GET", "/sitemaps/main.xml", async (req: FastifyRequest, reply: FastifyReply) => {
			await serveSitemap(host, this.#byHost.get(host) ?? [], req, reply, this.logger);
		});
		this.logger.logDebug(`Sitemap registrado en host ${host}`);
	}

	/**
	 * Hosts hermanos: misma "raíz" de dominio (último par `name.tld`), concretos
	 * (sin wildcards) y distintos del host índice.
	 */
	#computeSiblingHosts(indexHost: string): string[] {
		const baseDomain = indexHost.replace(/^\*\./, "");
		const out: string[] = [];
		for (const candidate of this.#byHost.keys()) {
			if (candidate === indexHost) continue;
			if (candidate.startsWith("*.")) continue;
			if (candidate === baseDomain || candidate.endsWith(`.${baseDomain}`)) out.push(candidate);
		}
		return out.sort();
	}

	// ============ Page Meta ============

	/** Marca hosts como SEO-habilitados. Idempotente. */
	enableForHosts(hostPatterns: string[], options?: { defaults?: PageMeta }): void {
		if (!hostPatterns?.length) return;
		for (const host of hostPatterns) {
			const state = this.#ensureHostState(host);
			state.enabled = true;
			if (options?.defaults) mergeDefaults(state.defaults, options.defaults);
		}
	}

	/** Declara la meta SEO por página. Rutas admiten `:param` y `*`. */
	registerPageMeta(options: RegisterPageMetaOptions): void {
		const hosts = collectHosts(options.hosting);
		if (!hosts.length) {
			this.logger.logDebug(`${options.appName}: sin hosting; pageMeta omitido`);
			return;
		}
		for (const host of hosts) {
			const state = this.#ensureHostState(host);
			if (options.defaults) mergeDefaults(state.defaults, options.defaults);
			for (const page of options.pages) {
				const compiled = compileEntry(page);
				if (compiled.exact) state.exact.set(compiled.path, compiled);
				else state.patterns.push(compiled);
			}
			this.#invalidateHostCache(host);
		}
		this.logger.logDebug(`SEO pageMeta registrado por ${options.appName} en ${hosts.length} host(s) (${options.pages.length} páginas)`);
	}

	#ensureHostState(host: string): HostSEOState {
		let state = this.#seoByHost.get(host);
		if (!state) {
			state = { enabled: false, defaults: {}, exact: new Map(), patterns: [] };
			this.#seoByHost.set(host, state);
		}
		return state;
	}

	#invalidateHostCache(host: string): void {
		const prefix = `${host}:`;
		for (const key of this.#renderCache.keys()) {
			if (key.startsWith(prefix)) this.#renderCache.delete(key);
		}
	}

	#installHook(): void {
		if (this.#hookInstalled || !this.#fastify) return;
		// TEMP DEBUG: desactivar el hook para verificar si el error es nuestro o de otro plugin.
		if (process.env.SEO_HOOK_DISABLED === "1") {
			this.logger.logWarn("SEO onSend hook DESACTIVADO por SEO_HOOK_DISABLED=1");
			this.#hookInstalled = true;
			return;
		}
		this.#injector ??= new HeadInjector({ seoByHost: this.#seoByHost, renderCache: this.#renderCache, logger: this.logger });
		const injector = this.#injector;
		const app = this.#fastify.getApp();
		// HOOK SÍNCRONO: si retornamos una Promise, Fastify introduce un microtask que
		// abre una ventana para que el cliente cierre la conexión antes del writeHead final
		// → `ERR_HTTP_HEADERS_SENT` lanzado desde `safeWriteHead` de Fastify.
		app.addHook("onSend", (request: unknown, reply: unknown, payload: unknown, done: (err: Error | null, val?: unknown) => void) => {
			const result = injector.onSend(request as FastifyRequest, reply as FastifyReply, payload);
			done(null, result);
		});
		this.#hookInstalled = true;
		this.logger.logDebug("SEO onSend hook instalado (sync)");
	}
}
