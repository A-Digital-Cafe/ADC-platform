import { ViteBaseStrategy } from "./base.js";
import type { IBuildContext } from "../types.js";
import { createImportMapPlugin, createFederationResolverPlugin } from "../shared/vite-federation.js";

/**
 * Estrategia Vite para React
 */
export class ReactViteStrategy extends ViteBaseStrategy {
	readonly name = "React (Vite)";
	readonly framework = "react";

	protected getFileExtension(): string {
		return ".tsx";
	}

	protected getResolveExtensions(): string[] {
		return [".tsx", ".ts", ".jsx", ".js", ".json", ".css"];
	}

	protected getOptimizeDepsInclude(): string[] {
		return ["react", "react-dom", "react-dom/client"];
	}

	protected getGlobals(): Record<string, string> {
		return {
			react: "React",
			"react-dom": "ReactDOM",
		};
	}

	protected async getVitePlugins(context: IBuildContext, isDev: boolean): Promise<any[]> {
		const plugins: any[] = [];

		// Plugin de React
		try {
			const { default: react } = await import("@vitejs/plugin-react");
			plugins.push(react());
		} catch (error: any) {
			context.logger?.logWarn(`@vitejs/plugin-react no instalado: ${error.message}`);
		}

		if (isDev) {
			// Plugins de desarrollo
			plugins.push(createImportMapPlugin(context), createFederationResolverPlugin(context));

			// Plugin de Module Federation para dev (si no es host)
			const isHost = context.module.uiConfig.isHost;
			if (!isHost) {
				try {
					const federationModule: any = await import("@originjs/vite-plugin-federation");
					const federation = federationModule.default;

					context.logger?.logDebug(`[${context.module.uiConfig.name}] Configurando Vite como REMOTE`);

					plugins.push(
						federation({
							name: context.module.uiConfig.name,
							filename: "remoteEntry.js",
							exposes: {
								"./App": "./src/App.tsx",
							},
							shared: {
								react: { singleton: true, requiredVersion: "^19.2.6" },
								"react-dom": { singleton: true, requiredVersion: "^19.2.6" },
							},
						})
					);
				} catch (error: any) {
					context.logger?.logWarn(`Error configurando Vite MF: ${error.message}`);
				}
			}
		}

		return plugins;
	}
}
