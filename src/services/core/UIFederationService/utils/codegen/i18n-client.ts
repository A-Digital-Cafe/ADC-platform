import type { RegisteredUIModule } from "../../types.js";
import { I18N_STATE_SCRIPT } from "./i18n-state.js";
import { I18N_LOADER_SCRIPT } from "./i18n-loader.js";
import { I18N_NO_SW_COMMENT, buildSwRegistration } from "./i18n-sw-register.js";

/**
 * Genera el código de inicialización del cliente para i18n y SW.
 * Cada app debe llamar a `loadTranslations(["module-name"])` con sus propios namespaces.
 */
export function generateI18nClientCode(module: RegisteredUIModule, _namespaceModules: Map<string, RegisteredUIModule>, _port: number): string {
	const namespace = module.namespace;
	const hasServiceWorker = module.uiConfig.serviceWorker === true;
	const isDev = process.env.NODE_ENV === "development";

	const swSection = hasServiceWorker ? buildSwRegistration(isDev) : I18N_NO_SW_COMMENT;

	return `// ADC i18n Client - Namespace: ${namespace} (Generic - cada app carga sus propias traducciones)
(function() {
${I18N_STATE_SCRIPT}
${I18N_LOADER_SCRIPT}
	${swSection}
})();
`;
}
