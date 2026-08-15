import type { RegisteredUIModule } from "../../types.js";
import type { UIFederationContext } from "../types/context.js";
import { parseFramework } from "../../strategies/index.js";
import { getUIModuleHostOptions } from "../security.js";

function serveStaticFallback(module: RegisteredUIModule, namespace: string, ctx: UIFederationContext): void {
	const urlPath = `/${namespace}/${module.name}`;
	if (module.outputPath) ctx.httpProvider?.serveStatic(urlPath, module.outputPath);
	ctx.logger.logOk(`Módulo UI ${module.name} [${namespace}] servido en http://localhost:${ctx.port}${urlPath}`);
}

function serveModuleInDev(module: RegisteredUIModule, namespace: string, bundler: string, ctx: UIFederationContext): void {
	const hasDevServer = module.uiConfig.devPort && (bundler === "rspack" || bundler === "vite");

	if (hasDevServer) {
		ctx.logger.logOk(`Módulo UI ${module.name} [${namespace}] disponible en Dev Server http://localhost:${module.uiConfig.devPort}`);
		return;
	}
	if (ctx.httpProvider && module.outputPath) serveStaticFallback(module, namespace, ctx);
}

function registerSubdomainHosts(
	subdomains: string[],
	domain: string,
	module: RegisteredUIModule,
	namespace: string,
	hostOptions: any,
	ctx: UIFederationContext
): string[] {
	const patterns: string[] = [];
	for (const subdomain of subdomains) {
		const pattern = `${subdomain}.${domain}`;
		if (module.outputPath) {
			ctx.httpProvider?.registerHost(pattern, module.outputPath, hostOptions);
			ctx.hostRegistry.set(pattern, { namespace, moduleName: module.name, directory: module.outputPath });
		}

		patterns.push(pattern);
	}
	return patterns;
}

/**
 * `GET /robots.txt` por host.
 *
 * Vive acá y no en `SEOService` porque ese preset es **opcional** y la mitad que más importa es la
 * del host interno: si el robots dependiera del preset, un despliegue sin él dejaría `admin.*` y
 * `modules.*` abiertos al rastreo.
 *
 * Rastrear ≠ indexar: `Disallow` evita la visita, pero una URL enlazada desde afuera puede aparecer
 * igual en los resultados. Lo que la saca del índice es `X-Robots-Tag: noindex`, que las apps
 * internas declaran en el `security.headers` de su `config.json`.
 *
 * Los patrones comodín siempre van `Disallow`: son el catch-all de subdominios no reclamados y
 * servirían el mismo contenido bajo infinitos hosts, que es contenido duplicado por definición.
 */
function registerRobots(patterns: string[], seoEnabled: boolean, ctx: UIFederationContext): void {
	for (const pattern of patterns) {
		const indexable = seoEnabled && !pattern.startsWith("*.");
		ctx.httpProvider?.registerHostRoute(pattern, "GET", "/robots.txt", (req: any, reply: any) => {
			const forwarded = req.headers["x-forwarded-proto"];
			const proto = (typeof forwarded === "string" ? forwarded.split(",")[0].trim() : "") || "https";
			const host = req.headers.host?.split(",")[0]?.trim() || pattern.replace(/^\*\./, "");
			const body = indexable
				? `User-agent: *\nAllow: /\n\nSitemap: ${proto}://${host}/sitemap.xml\n`
				: "User-agent: *\nDisallow: /\n";
			reply.header("Content-Type", "text/plain; charset=utf-8");
			reply.send(body);
		});
	}
}

async function registerHostsForModule(module: RegisteredUIModule, namespace: string, ctx: UIFederationContext): Promise<void> {
	const hosting = module.uiConfig.hosting;
	if (!hosting || !module.outputPath) return;

	const registeredPatterns: string[] = [];
	const hostOptions = getUIModuleHostOptions(module.uiConfig);

	for (const hostConfig of hosting) {
		for (const domain of hostConfig.domains) {
			if (hostConfig.subdomains) {
				registeredPatterns.push(...registerSubdomainHosts(hostConfig.subdomains, domain, module, namespace, hostOptions, ctx));
			} else {
				ctx.httpProvider?.registerHost(domain, module.outputPath, hostOptions);
				ctx.hostRegistry.set(domain, { namespace, moduleName: module.name, directory: module.outputPath });
				registeredPatterns.push(domain);
			}
		}
	}

	if (registeredPatterns.length > 0) {
		ctx.logger.logOk(`Módulo UI ${module.name} [${namespace}] servido en hosts: ${registeredPatterns.join(", ")}`);
		registerRobots(registeredPatterns, Boolean(module.uiConfig.enableSEO), ctx);
	}

	if (module.uiConfig.enableSEO) {
		const seo = ctx.getSEOService();
		if (seo) {
			seo.enableForHosts(registeredPatterns);
			ctx.logger.logDebug(`SEO habilitado para ${module.name} en ${registeredPatterns.length} host(s)`);
		} else {
			ctx.logger.logWarn(`enableSEO=true en ${module.name} pero SEOService no está disponible`);
		}
	}
}

async function serveModuleInProd(module: RegisteredUIModule, namespace: string, ctx: UIFederationContext): Promise<void> {
	if (!ctx.httpProvider || !module.outputPath) return;
	const hosting = module.uiConfig.hosting;

	if (hosting && ctx.httpProvider.supportsHostRouting()) {
		await registerHostsForModule(module, namespace, ctx);
	} else {
		serveStaticFallback(module, namespace, ctx);
	}
}

/** Sirve un módulo UI según su configuración (dev: por port/static; prod: host-based o static). */
export async function serveModule(module: RegisteredUIModule, namespace: string, ctx: UIFederationContext): Promise<void> {
	const { bundler } = parseFramework(module.uiConfig.framework || "astro");

	if (ctx.isDevelopment) {
		serveModuleInDev(module, namespace, bundler, ctx);
		return;
	}
	await serveModuleInProd(module, namespace, ctx);
}
