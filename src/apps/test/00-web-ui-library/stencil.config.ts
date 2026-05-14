import { Config } from '@stencil/core';

/**
 * Stencil config para web-ui-library
 *
 * Generado automáticamente por UIFederationService.
 * Los componentes usan CSS puro (compatible con Shadow DOM).
 */
export const config: Config = {
    namespace: 'web-ui-library',
    cacheDir: '../../../../temp/stencil-cache/default/web-ui-library',
    outputTargets: [
        {
            type: 'dist',
            dir: '../../../../temp/ui-builds/default/web-ui-library',
			typesDir: '../../../../temp/ui-builds/default/web-ui-library/types',
			isPrimaryPackageOutputTarget: true
        },
        {
            type: 'dist-custom-elements',
            dir: '../../../../temp/ui-builds/default/web-ui-library/custom-elements',
            customElementsExportBehavior: 'auto-define-custom-elements',
            externalRuntime: true,
			generateTypeDeclarations: true,
        },
    ],
    sourceMap: true,
    buildEs5: false,
};
