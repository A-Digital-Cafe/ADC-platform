import type { SwTemplateContext } from "./sw-context.js";

export function buildSwHeader(ctx: SwTemplateContext): string {
	const { namespace, moduleName, cacheRevision, isDevelopment, i18nNamespaces } = ctx;

	return `// Service Worker generado por UIFederationService
// Namespace: ${namespace} | Módulo: ${moduleName}
const CACHE_NAME = 'adc-${namespace}-v1';
const CACHE_REVISION = '${cacheRevision}';
const RUNTIME_CACHE = 'adc-runtime-${namespace}-' + CACHE_REVISION;
const UI_LIBRARY_CACHE = 'adc-ui-library-${namespace}-' + CACHE_REVISION;
const I18N_CACHE = 'adc-i18n-${namespace}-v1';
const IS_DEVELOPMENT = ${JSON.stringify(isDevelopment)};
const CURRENT_CACHES = [CACHE_NAME, RUNTIME_CACHE, UI_LIBRARY_CACHE, I18N_CACHE];

// URLs estáticas a cachear
const CACHE_URLS = [
	'/',
];

// Archivos que NUNCA se deben cachear (crítico para Module Federation y HMR)
const EXCLUDED_PATHS = [
	'remoteEntry.js',
	'mf-manifest.json',
	'.hot-update.js',
	'.hot-update.json',
	'lazy-compilation-proxy',
	's-hmr=',
	'__federation_expose_App',
	'/api/',
	'adc-sw.js',
	'adc-i18n.js'
];

// Namespaces i18n disponibles
const I18N_NAMESPACES = ${JSON.stringify(i18nNamespaces)};
`;
}

export function buildSwLifecycle(namespace: string): string {
	return `
self.addEventListener('install', (event) => {
	console.log('[SW ${namespace}] Instalando...');
	self.skipWaiting(); // Forzar activación inmediata
	// Precachear el shell para fallback offline (solo producción; en dev HMR sirve desde memoria)
	if (!IS_DEVELOPMENT) {
		event.waitUntil(
			caches.open(RUNTIME_CACHE).then((cache) => cache.addAll(CACHE_URLS)).catch(() => {})
		);
	}
});

self.addEventListener('activate', (event) => {
	console.log('[SW ${namespace}] Activando...');
	// Limpiar caches antiguos de otros namespaces/versiones
	event.waitUntil(
		caches.keys().then(keys => {
			return Promise.all(
				keys.filter(key => {
					if (!key.startsWith('adc-')) return false;
					if (!key.includes('${namespace}')) return false;
					if (IS_DEVELOPMENT && key.startsWith('adc-runtime-')) return true;

					// Mantener solo caches de este namespace y versión actual
					return !CURRENT_CACHES.includes(key);
				}).map(key => caches.delete(key))
			);
		}).then(() => self.clients.claim())
	);
});
`;
}
