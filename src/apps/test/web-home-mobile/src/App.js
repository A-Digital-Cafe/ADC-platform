// Traducciones locales (fallback si i18n del servidor no está disponible)
const localTranslations = {
	es: {
		title: "📊 Estadísticas",
		reload: "↻ Actualizar",
		loading: "Cargando...",
		stats: {
			totalUsers: "Usuarios Totales",
			totalGroups: "Usuarios Activos",
			totalRoles: "Roles"
		}
	},
	en: {
		title: "📊 Statistics",
		reload: "↻ Refresh",
		loading: "Loading...",
		stats: {
			totalUsers: "Total Users",
			totalGroups: "Active Users",
			totalRoles: "Roles"
		}
	}
};

/**
 * App de Home Mobile en Vanilla JavaScript
 * Interfaz optimizada para dispositivos móviles con tema oscuro
 * 
 * Las funciones t(), setLocale(), getLocale() están disponibles globalmente
 * desde adc-i18n.js (cargado en index.html del layout)
 */
export default class HomeApp {
	stats = null;
	loading = true;
	container = null;
	constructor() {
		this.locale = globalThis.getLocale ? globalThis.getLocale() : this.detectLocale();
	}
	
	detectLocale() {
		const stored = localStorage.getItem('language');
		if (stored) return stored.split('-')[0];
		return (navigator.language || 'en').split('-')[0];
	}
	
	t(key) {
		// Si existe t() global, usarla primero
		if (globalThis.t && globalThis.__ADC_I18N__?.loaded) {
			return globalThis.t(key, null, 'home');
		}
		// Fallback a traducciones locales
		const dict = localTranslations[this.locale] || localTranslations.en;
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
	mount(container) {
		this.container = container;
		this.render();
		this.loadStats();
	}

	/**
	 * Método para desmontar la aplicación
	 */
	unmount() {
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
			console.log('[Home Mobile] API no disponible, usando datos mock', error);
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
	 * Renderiza la interfaz móvil
	 */
	render() {
		if (!this.container) return;

		if (this.loading) {
			this.container.innerHTML = `
				<div style="
					display: flex;
					align-items: center;
					justify-content: center;
					min-height: 60vh;
					color: #a0aec0;
				">
					<div style="text-align: center;">
						<div style="
							width: 40px;
							height: 40px;
							border: 3px solid #4a5568;
							border-top-color: #805ad5;
							border-radius: 50%;
							animation: spin 1s linear infinite;
							margin: 0 auto 16px;
						"></div>
						<p style="margin: 0;">${this.t('loading')}</p>
					</div>
				</div>
				<style>
					@keyframes spin { to { transform: rotate(360deg); } }
				</style>
			`;
			return;
		}

		this.container.innerHTML = `
			<div style="padding: 8px 0;">
				<h2 style="
					margin: 0 0 20px;
					color: #e2e8f0;
					font-size: 1.25rem;
					font-weight: 600;
				">
					${this.t('title')}
				</h2>
				
				<div style="margin-bottom: 20px;">
					<adc-button id="reload-btn">
						${this.t('reload')}
					</adc-button>
				</div>

				${this.stats ? `
					<div style="
						display: flex;
						flex-direction: column;
						gap: 16px;
					">
						<adc-stat-card
							card-title="${this.t('stats.totalUsers')}"
							value="${this.stats.totalUsers}"
							color="#805ad5"
						></adc-stat-card>
						<adc-stat-card
							card-title="${this.t('stats.totalGroups')}"
							value="${this.stats.totalGroups}"
							color="#48bb78"
						></adc-stat-card>
						<adc-stat-card
							card-title="${this.t('stats.totalRoles')}"
							value="${this.stats.totalRoles}"
							color="#ed8936"
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

