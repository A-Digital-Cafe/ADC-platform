// Traducciones locales (fallback si i18n del servidor no está disponible)
const translations = {
	es: {
		title: "Estadísticas del Sistema",
		reload: "Recargar Estadísticas",
		loading: "Cargando...",
		stats: {
			totalUsers: "Usuarios Totales",
			totalGroups: "Grupos Totales",
			totalRoles: "Roles Totales"
		}
	},
	en: {
		title: "System Statistics",
		reload: "Reload Statistics",
		loading: "Loading...",
		stats: {
			totalUsers: "Total Users",
			totalGroups: "Total Groups",
			totalRoles: "Total Roles"
		}
	}
};

/**
 * App de Home en Vanilla JavaScript
 * Funciona como standalone y como microfrontend en web-layout
 * 
 * Usa Tailwind CSS para estilos optimizados
 */
export default class HomeApp {
	stats = null;
	loading = true;
	container = null;
	constructor() {
		this.locale = this.detectLocale();
	}
	
	detectLocale() {
		const stored = localStorage.getItem('language');
		if (stored) return stored.split('-')[0];
		return (navigator.language || 'en').split('-')[0];
	}
	
	t(key) {
		// Si existe t() global y hay traducciones cargadas para 'home', usarla
		if (globalThis.t && globalThis.__ADC_I18N__?.translations?.home) {
			return globalThis.t(key, null, 'home');
		}
		// Fallback a traducciones locales
		const dict = translations[this.locale] || translations.en;
		const keys = key.split('.');
		let value = dict;
		for (const k of keys) {
			if (value && typeof value === 'object' && k in value) {
				value = value[k];
			} else {
				return key;
			}
		}
		return typeof value === 'string' ? value : key;
	}

	/**
	 * Método principal para montar la aplicación
	 * @param {HTMLElement} container - Elemento donde se montará la app
	 */
	async mount(container) {
		this.container = container;
		this.render();

		// Cargar traducciones de este módulo
		if (globalThis.loadTranslations) {
			await globalThis.loadTranslations(['home']);
		}

		// Listener para actualizar UI cuando cambien las traducciones
		this.i18nListener = () => {
			this.locale = globalThis.getLocale?.() || this.detectLocale();
			this.render();
		};
		globalThis.addEventListener('adc:i18n:loaded', this.i18nListener);

		this.loadStats();
	}

	/**
	 * Método para desmontar la aplicación
	 */
	unmount() {
		// Limpiar listener de i18n
		if (this.i18nListener) {
			globalThis.removeEventListener('adc:i18n:loaded', this.i18nListener);
			this.i18nListener = null;
		}

		if (this.container) {
			this.container.innerHTML = '';
			this.container = null;
		}
	}

	/**
	 * Carga las estadísticas desde la API
	 */
	async loadStats() {
		this.loading = true;
		this.render();

		try {
			const response = await fetch('/api/dashboard/stats');
			if (!response.ok) {
				throw new Error('API no disponible');
			}
			const result = await response.json();
			if (result.success) {
				this.stats = result.data;
			}
		} catch (error) {
			console.log('[Home] API no disponible, usando datos mock', error);
			this.stats = {
				totalUsers: 150,
				totalGroups: 89,
				totalRoles: 8
			};
		} finally {
			this.loading = false;
			this.render();
		}
	}

	/**
	 * Handler para recargar estadísticas
	 */
	handleReload = () => {
		this.loadStats();
	}

	/**
	 * Renderiza la interfaz con clases de Tailwind CSS
	 */
	render() {
		if (!this.container) return;

		if (this.loading) {
			this.container.innerHTML = `
				<div class="flex items-center justify-center p-8">
					<div class="animate-pulse flex flex-col items-center gap-4">
						<div class="w-12 h-12 bg-blue-500 rounded-full animate-bounce"></div>
						<span class="text-gray-500 font-medium">${this.t('loading')}</span>
					</div>
				</div>
			`;
			return;
		}

		this.container.innerHTML = `
			<div class="p-4">
				<h2 class="text-2xl font-bold text-gray-800 mb-6">${this.t('title')}</h2>
				
				<adc-button id="reload-btn" variant="primary" size="md">
					${this.t('reload')}
				</adc-button>

				${this.stats ? `
					<div class="grid gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 mt-6">
						<adc-stat-card
							card-title="${this.t('stats.totalUsers')}"
							value="${this.stats.totalUsers}"
							color="primary"
						></adc-stat-card>
						<adc-stat-card
							card-title="${this.t('stats.totalGroups')}"
							value="${this.stats.totalGroups}"
							color="success"
						></adc-stat-card>
						<adc-stat-card
							card-title="${this.t('stats.totalRoles')}"
							value="${this.stats.totalRoles}"
							color="warning"
						></adc-stat-card>
					</div>
				` : ''}
			</div>
		`;

		// Agregar event listener al botón después de renderizar
		const reloadBtn = this.container.querySelector('#reload-btn');
		if (reloadBtn) {
			reloadBtn.addEventListener('adcClick', this.handleReload);
		}
	}
}

