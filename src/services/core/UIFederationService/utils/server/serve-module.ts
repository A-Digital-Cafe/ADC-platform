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
