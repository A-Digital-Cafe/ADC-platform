import type { RegisteredUIModule } from "../../types.js";
import type { ImportMap } from "../../../../../interfaces/modules/IUIModule.js";

const REACT_VERSION = "19.2.6";

function getReactImports(): Record<string, string> {
	return {
		react: `https://esm.sh/react@${REACT_VERSION}`,
		"react-dom": `https://esm.sh/react-dom@${REACT_VERSION}`,
		"react-dom/client": `https://esm.sh/react-dom@${REACT_VERSION}/client`,
		"react/jsx-runtime": `https://esm.sh/react@${REACT_VERSION}/jsx-runtime`,
		"react/jsx-dev-runtime": `https://esm.sh/react@${REACT_VERSION}/jsx-dev-runtime`,
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
		addModuleImports(imports, name, module, baseUrl, nsPrefix, isDevelopment, host);
	}

	return imports;
}

/** Convierte el registro de import maps a formato ImportMap */
export function createImportMapObject(imports: Record<string, string>): ImportMap {
	return { imports };
}
