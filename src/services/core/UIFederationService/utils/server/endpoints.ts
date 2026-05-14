import { DEFAULT_NAMESPACE, type UIFederationContext } from "../types/context.js";
import { createImportMapObject, generateCompleteImportMap } from "../bundler/import-map.js";

function getRequestHost(req: any): string {
	const hostHeader = req.headers?.host || req.hostname || "localhost";
	return hostHeader.split(":")[0];
}

function sendImportMap(ctx: UIFederationContext, namespace: string, host: string, reply: any): void {
	const namespaceModules = ctx.registry.getNamespaceModules(namespace);
	const imports = generateCompleteImportMap(namespaceModules, ctx.port, namespace, host);
	reply.header("Content-Type", "application/json");
	reply.send(createImportMapObject(imports));
}

function registerImportMapRoutes(ctx: UIFederationContext): void {
	ctx.httpProvider?.registerRoute("GET", "/:namespace/importmap.json", (req: any, reply: any) => {
		sendImportMap(ctx, req.params?.namespace || DEFAULT_NAMESPACE, getRequestHost(req), reply);
	});

	ctx.httpProvider?.registerRoute("GET", "/importmap.json", (req: any, reply: any) => {
		sendImportMap(ctx, DEFAULT_NAMESPACE, getRequestHost(req), reply);
	});

	ctx.httpProvider?.registerRoute("GET", "/api/ui/namespaces", (_req: any, reply: any) => {
		reply.send({ namespaces: ctx.registry.namespaces, default: DEFAULT_NAMESPACE });
	});
}

function registerI18nRoutes(ctx: UIFederationContext): void {
	ctx.httpProvider?.registerRoute("GET", "/api/i18n/:namespace", (req: any, reply: any) => {
		if (!ctx.langManager) {
			reply.code(503).send({ error: "LangManagerService no disponible" });
			return;
		}
		const translations = ctx.langManager.getTranslations(req.params?.namespace, req.query?.locale);
		reply.header("Content-Type", "application/json");
		reply.send(translations);
	});

	ctx.httpProvider?.registerRoute("GET", "/api/i18n", (req: any, reply: any) => {
		if (!ctx.langManager) {
			reply.code(503).send({ error: "LangManagerService no disponible" });
			return;
		}
		const namespaces = (req.query?.namespaces || "").split(",").filter(Boolean);
		if (namespaces.length === 0) {
			reply.send(ctx.langManager.getStats());
			return;
		}
		const translations = ctx.langManager.getBundledTranslations(namespaces, req.query?.locale);
		reply.header("Content-Type", "application/json");
		reply.send(translations);
	});
}

function buildNamespaceListHtml(ctx: UIFederationContext, host: string): string {
	const items = ctx.registry.namespaces
		.map((ns) => {
			const nsLayout = ctx.registry.getHostModule(ns);
			if (nsLayout?.uiConfig.devPort) {
				return `<li><a href="http://${host}:${nsLayout.uiConfig.devPort}/">${ns}</a></li>`;
			}
			return `<li><a href="/${ns}/${nsLayout?.name || "layout"}/">${ns}</a></li>`;
		})
		.join("");

	return `<!DOCTYPE html><html><head><title>UI Namespaces</title></head>
<body style="font-family: system-ui; padding: 20px;">
<h1>UI Namespaces Disponibles</h1><ul>${items}</ul>
</body></html>`;
}

function registerRootRedirect(ctx: UIFederationContext): void {
	ctx.httpProvider?.registerRoute("GET", "/", (req: any, reply: any) => {
		const layoutModule = ctx.registry.getHostModule(DEFAULT_NAMESPACE);
		const host = getRequestHost(req);

		if (layoutModule?.uiConfig.devPort) {
			reply.redirect(`http://${host}:${layoutModule.uiConfig.devPort}/`);
			return;
		}

		reply.header("Content-Type", "text/html");
		reply.send(buildNamespaceListHtml(ctx, host));
	});
}

/** Registra los endpoints HTTP base (import maps, namespaces, i18n, raíz dev). */
export async function setupImportMapEndpoints(ctx: UIFederationContext): Promise<void> {
	if (!ctx.httpProvider) return;
	registerImportMapRoutes(ctx);
	registerI18nRoutes(ctx);
	if (ctx.isDevelopment) registerRootRedirect(ctx);

	ctx.logger.logDebug(
		"Endpoints registrados: /:namespace/importmap.json, /importmap.json, /api/ui/namespaces" + (ctx.isDevelopment ? ", /" : "")
	);
}
