import { RspackBaseStrategy } from "./base.js";
import type { IBuildContext } from "../types.js";
import { buildCssRule } from "../shared/rspack-css-rule.js";
import { getHostTemplateConfig } from "../shared/rspack-helpers.js";

/**
 * Estrategia Rspack para JavaScript Vanilla con Module Federation.
 */
export class VanillaRspackStrategy extends RspackBaseStrategy {
	readonly name = "Vanilla JS (Rspack)";
	readonly framework = "vanilla";

	protected getFileExtension(): string {
		return ".js";
	}

	protected getResolveExtensions(): string[] {
		return [".js", ".json", ".css"];
	}

	protected getMainEntry(): string {
		return "./src/main.js";
	}

	protected getImports(): string {
		return `
import * as fs from 'node:fs';
import * as path from 'node:path';
import { rspack } from '@rspack/core';
const { ModuleFederationPlugin } = rspack.container;
`;
	}

	protected getModuleRules(_isProduction: boolean, postcssConfigPath: string): string {
		return String.raw`
            {
                test: /\.js$/,
                exclude: /node_modules/,
                type: 'javascript/auto',
            },${buildCssRule(postcssConfigPath)}
    `;
	}

	protected getPlugins(context: IBuildContext, isHost: boolean, usedFrameworks: Set<string>): string {
		const templateConfig = isHost ? getHostTemplateConfig(context) : `\n            template: './index.html',`;

		const featureFlags = usedFrameworks.has("vue")
			? `
        new rspack.DefinePlugin({
            __VUE_OPTIONS_API__: true,
            __VUE_PROD_DEVTOOLS__: false,
            __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
        }),`
			: "";

		const htmlPlugin = isHost
			? `
        new rspack.HtmlRspackPlugin({
            publicPath: '/',${templateConfig}
        }),`
			: "";

		return `${featureFlags}${htmlPlugin}
    `;
	}
}
