import type { RegisteredUIModule } from "../../types.js";
import type { ImportMap } from "../../../../../interfaces/modules/IUIModule.js";

/**
 * React se sirve desde el propio origen (`scripts/build-vendor-esm.mjs` lo empaqueta en
 * `common/public/vendor/react/`, que la UI federation ya publica en `/` para todas las apps).
 *
 * Antes apuntaba a `esm.sh`: eso le entregaba la IP de cada visitante a un tercero en **cada**
 * carga de página, antes de que la persona hiciera nada. Auto-hospedarlo lo elimina del todo y
 * permite sacar ese dominio del CSP. Las rutas son relativas a propósito: cada app las resuelve
 * contra su propio origen, sin cruzar subdominios ni puertos.
 */
function getReactImports(): Record<string, string> {
	return {
		react: "/vendor/react/react.js",
		"react-dom": "/vendor/react/react-dom.js",
		"react-dom/client": "/vendor/react/react-dom-client.js",
		"react/jsx-runtime": "/vendor/react/jsx-runtime.js",
		"react/jsx-dev-runtime": "/vendor/react/jsx-dev-runtime.js",
	};
}

function buildDevPortUrl(host: string | undefined, devPort: number): string {
	return host ? `http://${host}:${devPort}` : `http://localhost:${devPort}`;
}

function addStencilImports(imports: Record<string, string>, name: string, baseUrl: string, nsPrefix: string, isDevelopment: boolean): void {
	const prefix = isDevelopment ? `${baseUrl}${nsPrefix}` : nsPrefix;
	imports[`@${name}/loader`] = `${prefix}/${name}/loader/index.js`;
	imports[`@${name}/dist`] = `${prefix}/${name}/dist/`;
	imports[`@${name}/`] = `${prefix}/${name}/`;
}

function addModuleImports(
	imports: Record<string, string>,
	name: string,
	module: RegisteredUIModule,
	baseUrl: string,
	nsPrefix: string,
	isDevelopment: boolean,
	host?: string
): void {
	const framework = module.uiConfig.framework || "astro";

	if (framework === "stencil") {
		addStencilImports(imports, name, baseUrl, nsPrefix, isDevelopment);
		return;
	}

	if (isDevelopment && module.uiConfig.devPort && (framework === "react" || framework === "vue")) {
		const devUrl = buildDevPortUrl(host, module.uiConfig.devPort);
		imports[`@${name}`] = `${devUrl}/src/App.tsx`;
		imports[`@${name}/`] = `${devUrl}/`;
		return;
	}

	if (framework === "vite") {
		const prefix = isDevelopment ? `${baseUrl}${nsPrefix}` : nsPrefix;
		imports[`@${name}/`] = `${prefix}/${name}/`;
		return;
	}

	if (framework === "react" || framework === "vue") {
		imports[`@${name}`] = `${nsPrefix}/${name}/App.js`;
		imports[`@${name}/`] = `${nsPrefix}/${name}/`;
		return;
	}

	imports[`@${name}`] = `${nsPrefix}/${name}/index.html`;
	imports[`@${name}/`] = `${nsPrefix}/${name}/`;
}

/**
 * ¿El módulo es alcanzable bajo `/<namespace>/<nombre>/`?
 *
 * En producción `serveModule` monta ahí sólo a los que NO declaran `hosting`: los demás viven en
 * su propio host y esa URL no existe. Publicarlos igual dejaba specifiers que resolvían al
 * `index.html` del `spaFallback` —200 `text/html` donde el navegador espera un módulo— y, de paso,
 * le entregaba a los buscadores una lista de URLs-directorio para rastrear por cada host, que es
 * de donde salió el grueso de las páginas duplicadas.
 *
 * La federación entre apps no depende de esto: `loadRemoteComponent` arma la URL del
 * `remoteEntry.js` contra el origin de la app, no contra el import map.
 */
function isServedUnderNamespace(module: RegisteredUIModule, isDevelopment: boolean): boolean {
	return isDevelopment || !module.uiConfig.hosting?.length;
}

/**
 * Genera el import map completo con todos los módulos registrados de un namespace
 * @param registeredModules - Módulos registrados
 * @param port - Puerto del servidor principal
 * @param namespace - Namespace del UI
 * @param host - Host del request (ej: "192.168.1.100" o "localhost"). Si no se provee, usa rutas relativas.
 */
export function generateCompleteImportMap(
	registeredModules: Map<string, RegisteredUIModule>,
	port: number,
	namespace: string = "default",
	host?: string
): Record<string, string> {
	const isDevelopment = process.env.NODE_ENV === "development";
	const baseUrl = isDevelopment && host ? `http://${host}:${port}` : "";
	const nsPrefix = `/${namespace}`;
	const imports: Record<string, string> = getReactImports();

	for (const [name, module] of registeredModules.entries()) {
		if (!isServedUnderNamespace(module, isDevelopment)) continue;
		addModuleImports(imports, name, module, baseUrl, nsPrefix, isDevelopment, host);
	}

	return imports;
}

/** Convierte el registro de import maps a formato ImportMap */
export function createImportMapObject(imports: Record<string, string>): ImportMap {
	return { imports };
}
