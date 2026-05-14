import { RspackBaseStrategy } from "./base.js";
import type { IBuildContext } from "../types.js";
import { buildCssRule } from "../shared/rspack-css-rule.js";
import { getI18nTemplate } from "../shared/rspack-helpers.js";

/**
 * Estrategia Rspack para React con Module Federation.
 */
export class ReactRspackStrategy extends RspackBaseStrategy {
	readonly name = "React (Rspack)";
	readonly framework = "react";

	protected getFileExtension(): string {
		return ".tsx";
	}

	protected getResolveExtensions(): string[] {
		return [".tsx", ".ts", ".jsx", ".js", ".json", ".css"];
	}

	protected getMainEntry(): string {
		return "./src/main.tsx";
	}

	protected getImports(): string {
		return `
import * as fs from 'node:fs';
import * as path from 'node:path';
import { rspack } from '@rspack/core';
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
            },${buildCssRule(postcssConfigPath)}
    `;
	}

	protected getPlugins(context: IBuildContext, isHost: boolean, usedFrameworks: Set<string>): string {
		const hasI18n = context.module.uiConfig.i18n;
		const i18nScript = isHost && hasI18n ? getI18nTemplate(context) : `\n            template: './index.html',`;

		// Vue feature flags solo si algún remote usa Vue
		const vueFeatureFlags = usedFrameworks.has("vue")
			? `
        new rspack.DefinePlugin({
            __VUE_OPTIONS_API__: true,
            __VUE_PROD_DEVTOOLS__: false,
            __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
        }),`
			: "";

		const htmlPlugin = isHost
			? `
        new rspack.HtmlRspackPlugin({${i18nScript}
        }),`
			: "";

		return `${vueFeatureFlags}${htmlPlugin}
    `;
	}
}
