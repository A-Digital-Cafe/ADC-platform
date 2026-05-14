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
	if (isLayout) return `remotes: ${JSON.stringify(remotes, null, 4)},`;
	if (isRemote) return buildExposesConfig(context, appExtension);
	return "";
}

/** Decide el `publicPath` correcto según rol del módulo y entorno. */
export function resolvePublicPath(opts: { isRemote: boolean; isHost: boolean; isProduction: boolean; devPort: number | undefined }): string {
	const { isRemote, isHost, isProduction, devPort } = opts;
	if (isRemote && devPort && !isProduction) {
		return `'http://${getServerHost()}:${devPort}/'`;
	}
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
