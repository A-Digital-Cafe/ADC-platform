/**
 * Snippet de estado global e infraestructura del cliente i18n.
 * Strings raw - las `${...}` se ejecutan en runtime (cliente).
 */

export const I18N_STATE_SCRIPT = `	const STORAGE_KEY = 'language';

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
`;
