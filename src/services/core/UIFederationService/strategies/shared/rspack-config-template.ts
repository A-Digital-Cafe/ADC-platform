import * as path from "node:path";
import type { IBuildContext } from "../types.js";
import { normalizeForConfig } from "../../utils/fs/path-resolver.js";
import { buildSharedConfig, buildStaticDirectories } from "./rspack-helpers.js";
import {
	injectTailwindAlias,
	resolveFederationConfig,
	resolvePublicPath,
	buildDevServerBlock,
	buildDevAccessGate,
	buildCacheBlock,
} from "./rspack-template-helpers.js";
import { normalizeAccessRoles } from "@common/utils/ui-access.ts";

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
	/** Ruta final del `rspack.config.mjs`: entra como `buildDependency` de la caché. */
	configPath: string;
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
 * Nombres de archivo del build. En producción llevan `[contenthash]`, que es lo que permite
 * servirlos `immutable`: si el contenido cambia, cambia el nombre, así que ninguna caché
 * intermedia puede devolver algo viejo y no hace falta purgar nada al desplegar.
 *
 * `[name]` y no `[id]` en los chunks: los ids son números que se reordenan build a build, y los
 * chunks de los `exposes` de Module Federation necesitan un nombre estable para poder protegerlos
 * por ruta (ver `federationAccess`). `remoteEntry.js` no se ve afectado: su nombre lo fija el
 * ModuleFederationPlugin y los hosts lo referencian por URL.
 *
 * En desarrollo se dejan los nombres cortos de siempre: el hash sólo ensucia el log del bundler.
 */
function buildOutputFilenames(isProduction: boolean): string {
	if (!isProduction) return "";
	return `
        filename: '[name].[contenthash:8].js',
        chunkFilename: '[name].[contenthash:8].js',`;
}

/** `devtool` de desarrollo; ver la nota en {@link buildRspackConfigContent}. */
function devDevtool(): string {
	return process.env.ADC_UI_SOURCEMAPS === "true" ? "'eval-cheap-module-source-map'" : "'eval'";
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
		postcssConfigPath,
		tailwindCssPath,
		configPath,
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
	// `eval-*` en dev: los source maps van embebidos en el bundle en vez de escribirse como
	// archivo aparte, que es lo que más pesa en un rebuild incremental. `eval` pelado es el más
	// barato (no genera el mapa por módulo) a cambio de stack traces que apuntan al módulo
	// transpilado; `ADC_UI_SOURCEMAPS=true` recupera los mapas para depurar.
	//
	// En prod tiene que seguir siendo `false`: `security/headers.ts` omite `'unsafe-eval'` de
	// `script-src` **porque** no hay devtool `eval-*`, y con uno la CSP bloquearía el bundle.
	const devtool = isProduction ? "false" : devDevtool();
	const cacheBlock = buildCacheBlock(context, mode, configPath, [postcssConfigPath, tailwindCssPath].filter(Boolean));

	const finalAliasesObject = injectTailwindAlias(aliasesObject, tailwindCssPath, module.appDir);
	const shared = buildSharedConfig(usedFrameworks);
	const isRemote = module.uiConfig.isRemote ?? false;
	const federationConfig = resolveFederationConfig(isLayout, isRemote, remotes, context, appExtension);
	const hasExposes = !!module.uiConfig.federationExposes && Object.keys(module.uiConfig.federationExposes).length > 0;
	const publicPath = resolvePublicPath({ isRemote, isHost, isProduction, devPort: module.uiConfig.devPort, hasExposes });
	const staticDirs = buildStaticDirectories(context);
	// El gate de `uiModule.access` en dev: el kernel no sirve estas apps (cada una tiene su
	// propio dev server), así que sin esto el panel queda abierto justo donde más se prueba.
	const devAccessGate = isProduction ? "" : buildDevAccessGate(
				module.uiConfig.name,
				normalizeAccessRoles(module.uiConfig.access?.roles ?? []),
				module.uiConfig.access?.globalOnly === true,
				module.uiConfig.access?.requireAuth === true
			);
	const devServerConfig = buildDevServerBlock(module.uiConfig.devPort, !isProduction, staticDirs, context.namespace, devAccessGate);
	const outputFilenames = buildOutputFilenames(isProduction);

	const externalsLine =
		externals.length > 0
			? `
    externals: ${JSON.stringify(externals)},`
			: "";

	return `
${imports}

export default {
    mode: '${mode}',
    devtool: ${devtool},${cacheBlock}
    // Top-level desde rspack 2.0 (antes experiments.lazyCompilation). Debe ser
    // explícito: si queda undefined, \`rspack serve\` lo auto-activa con
    // { imports: true }, creando módulos "!lazy-compilation-proxy" para los
    // import() dinámicos de Stencil (*.entry.js) cuyos hot-updates rompen el
    // runtime HMR ("Cannot set properties of undefined") al recompilar la UI library.
    lazyCompilation: false,
    context: '${normalizeForConfig(module.appDir)}',
    entry: {
        main: '${mainEntry}',
    },
    output: {
        path: '${normalizeForConfig(path.join(uiOutputBaseDir, module.uiConfig.name))}',
        publicPath: ${publicPath},
        uniqueName: '${safeName}',${outputFilenames}
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
