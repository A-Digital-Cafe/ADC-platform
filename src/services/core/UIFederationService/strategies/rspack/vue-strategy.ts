import { RspackBaseStrategy } from "./base.js";
import type { IBuildContext } from "../types.js";
import { buildCssRule } from "../shared/rspack-css-rule.js";
import { getI18nTemplate } from "../shared/rspack-helpers.js";

/**
 * Estrategia Rspack para Vue con Module Federation.
 *
 * Particularidades respecto a otros frameworks:
 *  - Usa `vue-loader` para procesar `.vue` (su pitcher requiere `type: 'javascript/auto'` en css).
 *  - Desactiva `experiments.css` (vue-loader 17.x es incompatible con `experiments.css` de Rspack
 *    porque requiere `experimentalInlineMatchResource`, flag sólo de webpack).
 *  - Sobrescribe `getAdditionalRules()` para eliminar la regla `scheme: 'data'` que vue-loader clona
 *    internamente y rechaza con "Properties scheme are unknown".
 */
export class VueRspackStrategy extends RspackBaseStrategy {
	readonly name = "Vue (Rspack)";
	readonly framework = "vue";

	protected getFileExtension(): string {
		return ".vue";
	}

	protected getResolveExtensions(): string[] {
		return [".vue", ".tsx", ".ts", ".jsx", ".js", ".json", ".css"];
	}

	protected getMainEntry(): string {
		return "./src/main.ts";
	}

	protected getImports(): string {
		return `
import * as fs from 'node:fs';
import * as path from 'node:path';
import { rspack } from '@rspack/core';
import { VueLoaderPlugin } from 'vue-loader';
const { ModuleFederationPlugin } = rspack.container;
`;
	}

	protected getModuleRules(isProduction: boolean, postcssConfigPath: string): string {
		const development = isProduction ? "false" : "true";
		return String.raw`
            {
                test: /\.tsx?$/,
                use: {
                    loader: 'builtin:swc-loader',
                    options: {
                        jsc: {
                            parser: { syntax: 'typescript', tsx: true },
                            transform: { react: { runtime: 'automatic', development: ${development}, refresh: false } },
                        },
                    },
                },
                exclude: /node_modules/,
            },${buildCssRule(postcssConfigPath)},
            {
                test: /\.vue$/,
                loader: 'vue-loader',
                options: {
                    compilerOptions: {
                        // Reconocer web components con prefijo "adc-"
                        isCustomElement: (tag) => tag.startsWith('adc-'),
                    },
                },
                exclude: /node_modules/,
            }
    `;
	}

	protected getExperiments(): string {
		return `
        css: false,`;
	}

	protected getAdditionalRules(): string {
		return "";
	}

	protected getPlugins(context: IBuildContext, isHost: boolean, _usedFrameworks: Set<string>): string {
		const hasI18n = context.module.uiConfig.i18n;
		const i18nScript = isHost && hasI18n ? getI18nTemplate(context) : `\n            template: './index.html',`;

		const htmlPlugin = isHost
			? `
        new rspack.HtmlRspackPlugin({${i18nScript}
        }),`
			: "";

		return `
        new rspack.DefinePlugin({
            __VUE_OPTIONS_API__: true,
            __VUE_PROD_DEVTOOLS__: false,
            __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
        }),${htmlPlugin}
        new VueLoaderPlugin(),
    `;
	}
}
