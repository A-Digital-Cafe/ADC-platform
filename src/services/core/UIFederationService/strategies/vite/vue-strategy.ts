import { ViteBaseStrategy } from "./base.js";
import type { IBuildContext } from "../types.js";
import { createImportMapPlugin, createFederationResolverPlugin } from "../shared/vite-federation.js";

/**
 * Estrategia Vite para Vue
 */
export class VueViteStrategy extends ViteBaseStrategy {
	readonly name = "Vue (Vite)";
	readonly framework = "vue";

	protected getFileExtension(): string {
		return ".vue";
	}

	protected getResolveExtensions(): string[] {
		return [".vue", ".tsx", ".ts", ".jsx", ".js", ".json", ".css"];
	}

	protected getOptimizeDepsInclude(): string[] {
		return ["vue"];
	}

	protected getGlobals(): Record<string, string> {
		return {
			vue: "Vue",
		};
	}

	protected async getVitePlugins(context: IBuildContext, isDev: boolean): Promise<any[]> {
		const plugins: any[] = [];

		// Plugin de Vue
		try {
			const vueModule: any = await import("@vitejs/plugin-vue");
			const vue = vueModule.default;
			plugins.push(vue());
		} catch (error: any) {
			context.logger?.logWarn(`@vitejs/plugin-vue no instalado: ${error.message}`);
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
								"./App": "./src/App.vue",
							},
							shared: {
								vue: { singleton: true },
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
