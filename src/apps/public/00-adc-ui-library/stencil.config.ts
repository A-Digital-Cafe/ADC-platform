import { Config } from '@stencil/core';

/**
 * Stencil config para adc-ui-library
 *
 * Generado automáticamente por UIFederationService.
 * Los componentes usan CSS puro (compatible con Shadow DOM).
 */
export const config: Config = {
    namespace: 'adc-ui-library',
    cacheDir: '../../../../temp/stencil-cache/adc-platform/adc-ui-library',
    outputTargets: [
        {
            type: 'dist',
            dir: '../../../../temp/ui-builds/adc-platform/adc-ui-library',
			typesDir: '../../../../temp/ui-builds/adc-platform/adc-ui-library/types',
			isPrimaryPackageOutputTarget: true
        },
    ],
    // Los source maps de Stencil llevan `sourcesContent`: el TypeScript ORIGINAL completo,
    // incluido todo `src/common` que la library arrastra (permisos, planes, legal). El
    // directorio de salida se sirve entero por HTTP, así que en producción serían el código
    // fuente publicado. Se decide con `process.env` y no con un booleano horneado porque este
    // archivo queda commiteado y `bun run build:ui` lo reutiliza: si no, el valor dependería de
    // en qué modo corrió el kernel por última vez.
    sourceMap: process.env.NODE_ENV !== 'production',
    buildEs5: false,
};
