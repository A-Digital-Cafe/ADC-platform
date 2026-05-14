/**
 * Snippet de registro del Service Worker que se inyecta en el cliente i18n
 * cuando `serviceWorker: true`. Strings raw, sin interpolación TS.
 */

const DEV_CLEANUP = `
		navigator.serviceWorker.getRegistrations().then(registrations => {
			for (const registration of registrations) {
				if (registration.active && !registration.active.scriptURL.includes('adc-sw.js')) {
					registration.unregister();
					console.log('[SW] SW antiguo desregistrado');
				}
			}
		});`;

const SW_REGISTRATION_TEMPLATE = `	// Registrar Service Worker
	if ('serviceWorker' in navigator) {
		globalThis.addEventListener('load', () => {
			navigator.serviceWorker.register('/adc-sw.js', { updateViaCache: 'none' })
				.then((registration) => {
					console.log('[SW] Service Worker registrado:', registration.scope);
					// El SW se notificará cuando cada app cargue sus traducciones via loadTranslations
				})
				.catch((error) => {
					console.error('[SW] Error registrando Service Worker:', error);
				});
		});

		// Limpiar SWs viejos en desarrollo
		__DEV_CLEANUP__
	} else {
		console.warn('[SW] Service Workers solo estan disponible en localhost o https');
	}`;

export const I18N_NO_SW_COMMENT = "// Service Worker deshabilitado para este módulo";

export function buildSwRegistration(isDev: boolean): string {
	return SW_REGISTRATION_TEMPLATE.replace("__DEV_CLEANUP__", isDev ? DEV_CLEANUP : "");
}
