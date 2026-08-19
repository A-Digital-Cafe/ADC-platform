import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { IBuildContext } from "../types.js";

/**
 * Escribe `stencil.config.ts` en el directorio del módulo.
 * Stencil exige que el config viva en la app (no puede estar en `temp/`).
 * Output va a `temp/ui-builds/<namespace>/<moduleName>/` con cache en `temp/stencil-cache/`.
 *
 * Un solo output target (`dist`): es el que produce `loader/` + `esm/`, que son los que resuelven
 * los aliases (`@ui-library` → `init.js` → `loader/index.js` → `../esm/loader.js`).
 * `dist-custom-elements` se sacó porque no lo consumía nadie —ni el build ni el navegador— y
 * costaba build y 2 MB publicados por library.
 */
export async function writeStencilConfig(context: IBuildContext): Promise<string> {
	const { module, uiOutputBaseDir } = context;
	const namespace = module.uiConfig.uiNamespace || "default";

	const targetDir = path.join(uiOutputBaseDir, module.uiConfig.name);
	const relativeOutputDir = path.relative(module.appDir, targetDir).replaceAll("\\", "/");

	const cacheDir = path.resolve(process.cwd(), "temp", "stencil-cache", namespace, module.uiConfig.name);
	await fs.mkdir(cacheDir, { recursive: true });
	const relativeCacheDir = path.relative(module.appDir, cacheDir).replaceAll("\\", "/");

	const configContent = `import { Config } from '@stencil/core';

/**
 * Stencil config para ${module.uiConfig.name}
 *
 * Generado automáticamente por UIFederationService.
 * Los componentes usan CSS puro (compatible con Shadow DOM).
 */
export const config: Config = {
    namespace: '${module.uiConfig.name}',
    cacheDir: '${relativeCacheDir}',
    outputTargets: [
        {
            type: 'dist',
            dir: '${relativeOutputDir}',
			typesDir: '${relativeOutputDir}/types',
			isPrimaryPackageOutputTarget: true
        },
    ],
    // Los source maps de Stencil llevan \`sourcesContent\`: el TypeScript ORIGINAL completo,
    // incluido todo \`src/common\` que la library arrastra (permisos, planes, legal). El
    // directorio de salida se sirve entero por HTTP, así que en producción serían el código
    // fuente publicado. Se decide con \`process.env\` y no con un booleano horneado porque este
    // archivo queda commiteado y \`bun run build:ui\` lo reutiliza: si no, el valor dependería de
    // en qué modo corrió el kernel por última vez.
    sourceMap: process.env.NODE_ENV !== 'production',
    buildEs5: false,
};
`;

	const configPath = path.join(module.appDir, "stencil.config.ts");
	await fs.writeFile(configPath, configContent, "utf-8");
	context.logger?.logDebug(`Stencil config generado para ${module.uiConfig.name} [${namespace}]`);
	return configPath;
}
