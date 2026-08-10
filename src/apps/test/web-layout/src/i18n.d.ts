// Tipos globales para i18n generado por UIFederationService

interface I18nState {
	translations: Record<string, Record<string, string | object>>;
	locale: string | null;
	loading: boolean;
	loaded: boolean;
}

declare global {
	interface Window {
		__ADC_I18N__: I18nState;
		t: (key: string, params?: Record<string, string>, namespace?: string, fallback?: string) => string;
		setLocale: (locale: string) => void;
		getLocale: () => string;
	}

	// Funciones globales disponibles después de cargar adc-i18n.js
	function t(key: string, params?: Record<string, string>, namespace?: string): string;
	function setLocale(locale: string): void;
	function getLocale(): string;
}

export {};

