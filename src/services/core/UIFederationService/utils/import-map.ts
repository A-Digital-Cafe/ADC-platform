import type { RegisteredUIModule } from "../types.js";
import type { ImportMap } from "../../../../interfaces/modules/IUIModule.js";

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
	// Construir base URL dinámica: si hay host, usar http://{host}:{port}, si no, ruta relativa
	const baseUrl = isDevelopment && host ? `http://${host}:${port}` : "";
	const reactVersion = "19.2.6";
	const imports: Record<string, string> = {
		react: `https://esm.sh/react@${reactVersion}`,
		"react-dom": `https://esm.sh/react-dom@${reactVersion}`,
		"react-dom/client": `https://esm.sh/react-dom@${reactVersion}/client`,
		"react/jsx-runtime": `https://esm.sh/react@${reactVersion}/jsx-runtime`,
		"react/jsx-dev-runtime": `https://esm.sh/react@${reactVersion}/jsx-dev-runtime`,
	};

	for (const [name, module] of registeredModules.entries()) {
		const framework = module.uiConfig.framework || "astro";
		const nsPrefix = `/${namespace}`;
		// Para módulos con devPort propio, construir URL con el host dinámico
		const getDevPortUrl = (devPort: number) => (host ? `http://${host}:${devPort}` : `http://localhost:${devPort}`);

		if (framework === "stencil") {
			imports[`@${name}/loader`] = isDevelopment ? `${baseUrl}${nsPrefix}/${name}/loader/index.js` : `${nsPrefix}/${name}/loader/index.js`;
			imports[`@${name}/dist`] = isDevelopment ? `${baseUrl}${nsPrefix}/${name}/dist/` : `${nsPrefix}/${name}/dist/`;
			imports[`@${name}/`] = isDevelopment ? `${baseUrl}${nsPrefix}/${name}/` : `${nsPrefix}/${name}/`;
		} else if (isDevelopment && module.uiConfig.devPort && (framework === "react" || framework === "vue")) {
			imports[`@${name}`] = `${getDevPortUrl(module.uiConfig.devPort)}/src/App.tsx`;
			imports[`@${name}/`] = `${getDevPortUrl(module.uiConfig.devPort)}/`;
		} else if (framework === "vite") {
			imports[`@${name}/`] = isDevelopment ? `${baseUrl}${nsPrefix}/${name}/` : `${nsPrefix}/${name}/`;
		} else if (framework === "react" || framework === "vue") {
			imports[`@${name}`] = `${nsPrefix}/${name}/App.js`;
			imports[`@${name}/`] = `${nsPrefix}/${name}/`;
		} else {
			imports[`@${name}`] = `${nsPrefix}/${name}/index.html`;
			imports[`@${name}/`] = `${nsPrefix}/${name}/`;
		}
	}

	return imports;
}

/**
 * Convierte el registro de import maps a formato ImportMap
 */
export function createImportMapObject(imports: Record<string, string>): ImportMap {
	return { imports };
}
