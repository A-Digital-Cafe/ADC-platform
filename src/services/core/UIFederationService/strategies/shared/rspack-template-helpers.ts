import * as path from "node:path";
import { normalizeForConfig, getServerHost } from "../../utils/fs/path-resolver.js";
import type { IBuildContext } from "../types.js";
import { buildExposesConfig } from "./rspack-helpers.js";

/** Inserta el alias de Tailwind v4 si está habilitado. */
export function injectTailwindAlias(aliasesObject: string, tailwindCssPath: string, appDir: string): string {
	if (!tailwindCssPath) return aliasesObject;

	const originalTailwindCss = normalizeForConfig(path.join(appDir, "src", "styles", "tailwind.css"));
	const generatedTailwindCss = normalizeForConfig(tailwindCssPath);

	if (aliasesObject === "{}") {
		return `{\n            '${originalTailwindCss}': '${generatedTailwindCss}'\n        }`;
	}

	return aliasesObject.replace(/\n {8}\}$/, `,\n            '${originalTailwindCss}': '${generatedTailwindCss}'\n        }`);
}

/** Decide el bloque federation para ModuleFederationPlugin (remotes / exposes / vacío). */
export function resolveFederationConfig(
	isLayout: boolean,
	isRemote: boolean,
	remotes: Record<string, string>,
	context: IBuildContext,
	appExtension: string
): string {
	const federationExposes = context.module.uiConfig.federationExposes;
	const hasExposes = !!federationExposes && Object.keys(federationExposes).length > 0;
	if (isLayout) return `remotes: ${JSON.stringify(remotes, null, 4)},`;
	// Un host también puede exponer remotes si declara `federationExposes`
	// (ej: resolvers de enlaces de plataforma consumidos por otras apps).
	if (isRemote || hasExposes) return buildExposesConfig(context, appExtension);
	return "";
}

/** Decide el `publicPath` correcto según rol del módulo y entorno. */
export function resolvePublicPath(opts: {
	isRemote: boolean;
	isHost: boolean;
	isProduction: boolean;
	devPort: number | undefined;
	hasExposes?: boolean;
}): string {
	const { isRemote, isHost, isProduction, devPort, hasExposes } = opts;
	// Un módulo que expone remotes (sea `isRemote` o un host con `federationExposes`)
	// debe servir sus chunks desde su propio origen para que otras apps los consuman.
	const servesRemote = isRemote || !!hasExposes;
	// Un host (tiene su propio index.html y se abre directo) que además expone debe
	// usar 'auto': resuelve sus chunks según el origen desde el que se cargue
	// (localhost vs IP de LAN), evitando el error cross-origin "Script error." al
	// inyectar `remoteEntry.js` con un host distinto al de la página.
	if (servesRemote && isHost) return "'auto'";
	if (servesRemote && devPort && !isProduction) {
		return `'http://${getServerHost()}:${devPort}/'`;
	}
	if (servesRemote) return "'auto'";
	if (isHost) return "'/'";
	return "'auto'";
}

/** Construye el bloque `devServer` (con proxy a i18n/sw del kernel). */
export function buildDevServerBlock(devPort: number | undefined, hotReload: boolean, staticDirs: string): string {
	return `
    devServer: {
        host: '0.0.0.0',
        port: ${devPort},
        hot: ${hotReload},
        historyApiFallback: true,
        allowedHosts: 'all',
        static: ${staticDirs},
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
            'Access-Control-Allow-Headers': 'X-Requested-With, content-type, Authorization',
        },
        proxy: [
            {
                context: ['/adc-sw.js', '/adc-i18n.js', '/api/i18n'],
                target: 'http://localhost:3000',
                changeOrigin: true,
            },
        ],
    },`;
}
