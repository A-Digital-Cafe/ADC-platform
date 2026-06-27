import { generateCompleteImportMap } from "../../utils/bundler/import-map.js";
import { buildResponsiveRedirectScript } from "../../utils/codegen/html-templates.js";
import { getServerHost } from "../../utils/fs/path-resolver.js";
import type { IBuildContext } from "../types.js";

const HOST_DEV_PORT = 3000; // Puerto del servidor principal

/**
 * Plugin Vite (solo dev) que inyecta antes de `</head>` el `<script type="importmap">`
 * con todos los módulos federados y, si el módulo declara `responsive`, el
 * auto-redirect entre variantes desktop/mobile (mismo helper que el path rspack).
 */
export function createImportMapPlugin(context: IBuildContext): any {
	const { registeredModules } = context;

	return {
		name: "inject-importmap",
		transformIndexHtml: {
			order: "pre",
			handler(html: string) {
				const importMap = generateCompleteImportMap(registeredModules, HOST_DEV_PORT);
				const serialized = JSON.stringify({ imports: importMap }, null, 6).replaceAll("\n", "\n    ");
				const importMapScript = `    <script type="importmap">\n${serialized}\n    </script>`;
				const redirect = buildResponsiveRedirectScript(context.module.uiConfig.responsive);
				const redirectBlock = redirect ? `    ${redirect}\n` : "";
				const headBlock = `${importMapScript}\n${redirectBlock}  </head>`;

				if (html.includes("</head>")) {
					return html.replaceAll("</head>", headBlock);
				}
				return html;
			},
		},
	};
}

/**
 * Plugin Vite (solo dev) que resuelve imports `@module-name` y `@module-name/path`
 * apuntándolos al dev server correspondiente como módulos externos.
 */
export function createFederationResolverPlugin(context: IBuildContext): any {
	const { registeredModules } = context;
	const serverHost = getServerHost();

	return {
		name: "federation-dev-resolver",
		enforce: "pre" as const,
		resolveId(source: string) {
			const federatedHosts: Record<string, string> = {};

			for (const [moduleName, module] of registeredModules.entries()) {
				if (module.uiConfig.devPort) {
					federatedHosts[`@${moduleName}/`] = `http://${serverHost}:${module.uiConfig.devPort}/`;
				} else {
					federatedHosts[`@${moduleName}/`] = `http://${serverHost}:${HOST_DEV_PORT}/${moduleName}/`;
				}
			}

			for (const prefix of Object.keys(federatedHosts)) {
				const resolved = resolveFederatedId(source, prefix, federatedHosts[prefix], registeredModules);
				if (resolved) return resolved;
			}
			return null;
		},
	};
}

function resolveFederatedId(
	source: string,
	prefix: string,
	hostUrl: string,
	registeredModules: IBuildContext["registeredModules"]
): { id: string; external: true } | null {
	const moduleName = prefix.slice(1, -1);

	if (source === `@${moduleName}`) {
		const framework = registeredModules.get(moduleName)?.uiConfig.framework || "react";
		const appExtension = framework === "vue" ? ".vue" : ".tsx";
		return { id: `${hostUrl}src/App${appExtension}`, external: true };
	}

	if (source.startsWith(prefix)) {
		const module = registeredModules.get(moduleName);
		const remainder = source.substring(prefix.length);
		if (module?.uiConfig.framework === "vite") {
			const withJs = remainder.endsWith(".js") ? remainder : `${remainder}.js`;
			return { id: `${hostUrl}${withJs}`, external: true };
		}
		const withoutJs = remainder.replace(/\.js$/, "");
		return { id: `${hostUrl}${withoutJs}`, external: true };
	}

	return null;
}
