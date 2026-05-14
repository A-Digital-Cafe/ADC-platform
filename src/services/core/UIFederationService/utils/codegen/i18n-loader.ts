/**
 * Snippet del loader y setters de locale del cliente i18n.
 * Strings raw - las `${...}` se ejecutan en runtime (cliente).
 */

export const I18N_LOADER_SCRIPT = `	// Cargar traducciones (debe ser llamado por cada app con sus propios namespaces)
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
`;
