import * as path from "node:path";
import type { IBuildContext } from "../types.js";
import { normalizeForConfig, getCommonPublicDir } from "../../utils/fs/path-resolver.js";

/**
 * Construye la configuración de `shared` para ModuleFederationPlugin.
 * - `@stencil/core` siempre como singleton (evita "invalid Stencil runtime")
 * - Agrega react/vue cuando los frameworks aparecen en el grafo.
 */
export function buildSharedConfig(usedFrameworks: Set<string>): string {
	const sharedLibs: string[] = ["'@stencil/core': { singleton: true, eager: true, strictVersion: false }"];

	if (usedFrameworks.has("react")) {
		sharedLibs.push(
			"react: { singleton: true, requiredVersion: '^19.2.6', eager: true, strictVersion: false }",
			"'react-dom': { singleton: true, requiredVersion: '^19.2.6', eager: true, strictVersion: false }",
			"'react/jsx-dev-runtime': { singleton: true, eager: true, strictVersion: false }"
		);
	}

	if (usedFrameworks.has("vue")) {
		sharedLibs.push("vue: { singleton: true, eager: true }");
	}

	return `{
        ${sharedLibs.join(",\n        ")}
    }`;
}

/**
 * Construye `exposes` para Module Federation.
 * Si el módulo tiene `federationExposes` definido en su config, se respeta;
 * caso contrario expone `./App` apuntando a `./src/App<ext>`.
 */
export function buildExposesConfig(context: IBuildContext, appExtension: string): string {
	const federationExposes = context.module.uiConfig.federationExposes;

	if (federationExposes && Object.keys(federationExposes).length > 0) {
		const exposesEntries = Object.entries(federationExposes)
			.map(([key, value]) => `                '${key}': '${value}'`)
			.join(",\n");
		return `
            filename: 'remoteEntry.js',
            exposes: {
${exposesEntries}
            },`;
	}

	return `
            filename: 'remoteEntry.js',
            exposes: {
                './App': './src/App${appExtension}',
            },`;
}

/**
 * Lee el `index.html` del módulo e inyecta `<script src="/adc-i18n.js"></script>`
 * antes de `</head>` (vía `templateContent`).
 */
export function getI18nTemplate(context: IBuildContext): string {
	const indexHtmlPath = normalizeForConfig(path.join(context.module.appDir, "index.html"));
	return String.raw`
            scriptLoading: 'blocking',
            inject: 'body',
            templateContent: () => {
                const html = fs.readFileSync('${indexHtmlPath}', 'utf-8');
                return html.replace('</head>', '    <script src="/adc-i18n.js"></script>\n  </head>');
            },`;
}

/**
 * Genera el array de `static` para `devServer` de rspack.
 * Sirve:
 *   - `public/` del módulo en `/` (alta prioridad para favicon etc.)
 *   - `common/public/` en `/` como fallback global
 *   - `public/` de uiDependencies stencil en `/ui/`
 */
export function buildStaticDirectories(context: IBuildContext): string {
	const { module, registeredModules } = context;
	const staticConfigs: string[] = [];

	const ownPublicDir = normalizeForConfig(path.join(module.appDir, "public"));
	staticConfigs.push(`{
            directory: '${ownPublicDir}',
            publicPath: '/',
        }`);

	const commonPublicDir = normalizeForConfig(getCommonPublicDir());
	staticConfigs.push(`{
            directory: '${commonPublicDir}',
            publicPath: '/',
        }`);

	for (const depName of module.uiConfig.uiDependencies || []) {
		const depModule = registeredModules.get(depName);
		if (depModule?.uiConfig.framework === "stencil") {
			const depPublicDir = normalizeForConfig(path.join(depModule.appDir, "public"));
			staticConfigs.push(`{
            directory: '${depPublicDir}',
            publicPath: '/ui/',
        }`);
		}
	}

	return `[
            ${staticConfigs.join(",\n            ")}
        ]`;
}
