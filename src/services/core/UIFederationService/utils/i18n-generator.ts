import { RegisteredUIModule } from "../types.js";

/**
 * Genera el código de inicialización del cliente para i18n y SW (genérico - sin hardcodear namespaces)
 */
export function generateI18nClientCode(module: RegisteredUIModule, _namespaceModules: Map<string, RegisteredUIModule>, _port: number): string {
	const namespace = module.namespace;
	const hasServiceWorker = module.uiConfig.serviceWorker === true;

	const isDev = process.env.NODE_ENV === "development";

	return `// ADC i18n Client - Namespace: ${namespace} (Generic - cada app carga sus propias traducciones)
(function() {
	const STORAGE_KEY = 'language';
	
	// Estado global de traducciones
	globalThis.__ADC_I18N__ = globalThis.__ADC_I18N__ || {
		translations: {},
		translationLocales: {},
		pendingLoads: {},
		locale: null,
		loading: false,
		loaded: false,
	};
	globalThis.__ADC_I18N__.translationLocales = globalThis.__ADC_I18N__.translationLocales || {};
	globalThis.__ADC_I18N__.pendingLoads = globalThis.__ADC_I18N__.pendingLoads || {};
	
	// Detectar locale: localStorage > navegador > 'en'
	function detectLocale() {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored) return stored;
		
		const browserLang = navigator.language || navigator.languages?.[0] || 'en';
		return browserLang.split('-')[0];
	}
	
	// Función t() global para traducciones
	globalThis.t = function(key, params, namespace) {
		const state = globalThis.__ADC_I18N__;
		// Si no se especifica namespace, usar el primero cargado
		const ns = namespace || Object.keys(state.translations)[0] || 'default';
		const translations = state.translations[ns] || {};
		
		const keys = key.split('.');
		let value = translations;
		for (const k of keys) {
			if (value && typeof value === 'object' && k in value) {
				value = value[k];
			} else {
				return key;
			}
		}
		
		if (typeof value !== 'string') return key;
		
		if (params) {
			return value.replace(/\\{\\{(\\w+)\\}\\}/g, (_, p) => params[p] ?? \`{{\${p}}}\`);
		}
		
		return value;
	};
	
	// Cargar traducciones (debe ser llamado por cada app con sus propios namespaces)
	globalThis.loadTranslations = async function(namespaces, locale) {
		if (!namespaces || !Array.isArray(namespaces)) {
			console.error('[i18n] loadTranslations requiere un array de namespaces. Ejemplo: loadTranslations(["module-name"])');
			return;
		}

		const state = globalThis.__ADC_I18N__;
		state.translationLocales = state.translationLocales || {};
		state.pendingLoads = state.pendingLoads || {};
		const targetLocale = locale || state.locale || detectLocale();

		state.locale = targetLocale;
		state.loading = true;

		try {
			await Promise.all(namespaces.map(async function(ns) {
				// Skip si ya está cargado para el locale actual
				if (state.translations[ns] && state.translationLocales[ns] === targetLocale) return;

				const loadKey = targetLocale + ':' + ns;
				if (!state.pendingLoads[loadKey]) {
					state.pendingLoads[loadKey] = (async function() {
						const url = '/api/i18n/' + encodeURIComponent(ns) + '?locale=' + encodeURIComponent(targetLocale);
						const response = await fetch(url);
						if (response.ok) {
							state.translations[ns] = await response.json();
							state.translationLocales[ns] = targetLocale;
							console.log('[i18n] Traducciones cargadas: ' + ns + ' (' + targetLocale + ')');
						}
					})().finally(function() {
						delete state.pendingLoads[loadKey];
					});
				}

				await state.pendingLoads[loadKey];
			}));
			state.loaded = true;

			globalThis.dispatchEvent(new CustomEvent('adc:i18n:loaded', {
				detail: { locale: targetLocale, namespaces }
			}));

			// Notificar al SW para pre-cachear estas traducciones
			if (navigator.serviceWorker?.controller) {
				navigator.serviceWorker.controller.postMessage({
					type: 'PRELOAD_I18N',
					locale: targetLocale,
					namespaces
				});
			}
		} catch (error) {
			console.error('[i18n] Error cargando traducciones:', error);
		} finally {
			state.loading = false;
		}
	};
	
	// Cambiar locale (recarga traducciones ya cargadas con el nuevo locale)
	globalThis.setLocale = function(locale) {
		localStorage.setItem(STORAGE_KEY, locale);
		const state = globalThis.__ADC_I18N__;
		const loadedNamespaces = Object.keys(state.translations);

		state.locale = locale;
		globalThis.loadTranslations(loadedNamespaces, locale);

		if (navigator.serviceWorker?.controller) {
			navigator.serviceWorker.controller.postMessage({
				type: 'PRELOAD_I18N',
				locale: locale,
				namespaces: loadedNamespaces
			});
		}
	};

	// Obtener locale actual
	globalThis.getLocale = function() {
		return globalThis.__ADC_I18N__.locale || detectLocale();
	};

	// Inicializar locale (sin cargar traducciones - cada app carga las suyas)
	const initialLocale = detectLocale();
	globalThis.__ADC_I18N__.locale = initialLocale;
	
	${
		hasServiceWorker
			? `
	// Registrar Service Worker
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
		${
			isDev
				? `
		navigator.serviceWorker.getRegistrations().then(registrations => {
			for (const registration of registrations) {
				if (registration.active && !registration.active.scriptURL.includes('adc-sw.js')) {
					registration.unregister();
					console.log('[SW] SW antiguo desregistrado');
				}
			}
		});
		`
				: ""
		}
	} else {
		console.warn('[SW] Service Workers solo estan disponible en localhost o https');
	}
	`
			: "// Service Worker deshabilitado para este módulo"
	}
})();
`;
}
