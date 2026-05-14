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
        {
            type: 'dist-custom-elements',
            dir: '../../../../temp/ui-builds/adc-platform/adc-ui-library/custom-elements',
            customElementsExportBehavior: 'auto-define-custom-elements',
            externalRuntime: true,
			generateTypeDeclarations: true,
        },
    ],
    sourceMap: true,
    buildEs5: false,
};
