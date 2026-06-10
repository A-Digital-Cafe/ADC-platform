import * as path from "node:path";
import type { IBuildContext } from "../types.js";
import { normalizeForConfig } from "../../utils/fs/path-resolver.js";
import { buildSharedConfig, buildStaticDirectories } from "./rspack-helpers.js";
import { injectTailwindAlias, resolveFederationConfig, resolvePublicPath, buildDevServerBlock } from "./rspack-template-helpers.js";

export interface IRspackConfigOptions {
	context: IBuildContext;
	safeName: string;
	isLayout: boolean;
	isHost: boolean;
	isProduction: boolean;
	remotes: Record<string, string>;
	externals: string[];
	usedFrameworks: Set<string>;
	aliasesObject: string;
	postcssConfigPath: string;
	tailwindCssPath: string;
	configDir: string;
	appExtension: string;
	mainEntry: string;
	extensions: string[];
	moduleRules: string;
	plugins: string;
	imports: string;
	experiments: string;
	additionalRules: string;
}

/**
 * Construye el contenido completo de `rspack.config.mjs` a partir de las opciones.
 * Centraliza el template para todos los frameworks rspack.
 */
export function buildRspackConfigContent(options: IRspackConfigOptions): string {
	const {
		context,
		safeName,
		isLayout,
		isHost,
		isProduction,
		remotes,
		externals,
		usedFrameworks,
		aliasesObject,
		tailwindCssPath,
		appExtension,
		mainEntry,
		extensions,
		moduleRules,
		plugins,
		imports,
		experiments,
		additionalRules,
	} = options;

	const { module, uiOutputBaseDir } = context;
	const mode = isProduction ? "production" : "development";
	const devtool = isProduction ? "false" : "'cheap-module-source-map'";

	const finalAliasesObject = injectTailwindAlias(aliasesObject, tailwindCssPath, module.appDir);
	const shared = buildSharedConfig(usedFrameworks);
	const isRemote = module.uiConfig.isRemote ?? false;
	const federationConfig = resolveFederationConfig(isLayout, isRemote, remotes, context, appExtension);
	const hasExposes = !!module.uiConfig.federationExposes && Object.keys(module.uiConfig.federationExposes).length > 0;
	const publicPath = resolvePublicPath({ isRemote, isHost, isProduction, devPort: module.uiConfig.devPort, hasExposes });
	const staticDirs = buildStaticDirectories(context);
	const devServerConfig = buildDevServerBlock(module.uiConfig.devPort, !isProduction, staticDirs);

	const externalsLine =
		externals.length > 0
			? `
    externals: ${JSON.stringify(externals)},`
			: "";

	return `
${imports}

export default {
    mode: '${mode}',
    devtool: ${devtool},
    context: '${normalizeForConfig(module.appDir)}',
    entry: {
        main: '${mainEntry}',
    },
    output: {
        path: '${normalizeForConfig(path.join(uiOutputBaseDir, module.uiConfig.name))}',
        publicPath: ${publicPath},
        uniqueName: '${safeName}',
    },
    resolve: {
        extensions: ${JSON.stringify(extensions)},
        extensionAlias: {
            '.js': ['.ts', '.tsx', '.js'],
            '.mjs': ['.mts', '.mjs'],
        },
        alias: ${finalAliasesObject},
    },${externalsLine}
    module: {
        rules: [
            ${moduleRules},${additionalRules}
        ],
    },
    experiments: {${experiments}
    },
    plugins: [
        new rspack.DefinePlugin({
            'process.env.NODE_ENV': JSON.stringify('${mode}'),
        }),
        ${plugins}
        new ModuleFederationPlugin({
            name: '${safeName}',
            runtime: false,
            ${federationConfig}
            shared: ${shared},
        }),
    ],${devServerConfig}
    ignoreWarnings: [
        /Critical dependency.*expression/,
    ],
    performance: {
        hints: ${isProduction ? "'warning'" : "false"},
        maxAssetSize: 512000,
        maxEntrypointSize: 512000,
    },
};
`;
}
