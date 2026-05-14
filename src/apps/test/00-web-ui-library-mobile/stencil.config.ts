import { Config } from '@stencil/core';

/**
 * Stencil config para web-ui-library-mobile
 *
 * Generado automáticamente por UIFederationService.
 * Los componentes usan CSS puro (compatible con Shadow DOM).
 */
export const config: Config = {
    namespace: 'web-ui-library-mobile',
    cacheDir: '../../../../temp/stencil-cache/mobile/web-ui-library-mobile',
    outputTargets: [
        {
            type: 'dist',
            dir: '../../../../temp/ui-builds/mobile/web-ui-library-mobile',
			typesDir: '../../../../temp/ui-builds/mobile/web-ui-library-mobile/types',
			isPrimaryPackageOutputTarget: true
        },
        {
            type: 'dist-custom-elements',
            dir: '../../../../temp/ui-builds/mobile/web-ui-library-mobile/custom-elements',
            customElementsExportBehavior: 'auto-define-custom-elements',
            externalRuntime: true,
			generateTypeDeclarations: true,
        },
    ],
    sourceMap: true,
    buildEs5: false,
};
