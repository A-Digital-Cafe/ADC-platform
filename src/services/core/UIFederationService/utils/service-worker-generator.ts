import type { RegisteredUIModule } from "../types.js";

function createCacheRevision(module: RegisteredUIModule, namespaceModules: Map<string, RegisteredUIModule>): string {
	const uiLibraryRevisions = Array.from(namespaceModules.values())
		.filter((mod) => mod.uiConfig.framework === "stencil")
		.map((mod) => `${mod.name}-${mod.registeredAt || 0}`)
		.sort()
		.join("-");

	return `${module.name}-${module.registeredAt || Date.now()}-${uiLibraryRevisions || "no-ui-library"}`.replaceAll(
		/[^a-zA-Z0-9_-]/g,
		"-"
	);
}

/**
 * Genera el contenido del service worker para una app
 */
export function generateServiceWorker(module: RegisteredUIModule, namespaceModules: Map<string, RegisteredUIModule>, _port: number): string {
	const namespace = module.namespace;
	const moduleName = module.name;
	const isDevelopment = process.env.NODE_ENV !== "production";
	const cacheRevision = createCacheRevision(module, namespaceModules);

	// Obtener los namespaces de i18n de los módulos del mismo namespace
	const i18nNamespaces: string[] = [];
	for (const [name, mod] of namespaceModules.entries()) {
		if (mod.uiConfig.i18n) {
			i18nNamespaces.push(name);
		}
	}

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

self.addEventListener('install', (event) => {
	console.log('[SW ${namespace}] Instalando...');
	self.skipWaiting(); // Forzar activación inmediata
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

self.addEventListener('fetch', (event) => {
	const { request } = event;
	const url = new URL(request.url);

	// Ignorar peticiones que no sean GET
	if (request.method !== 'GET') return;

	// Ignorar extensiones de navegador y protocolos extraños
	if (!url.protocol.startsWith('http')) return;

	// CRÍTICO: No cachear archivos de Module Federation y HMR
	const isExcluded = EXCLUDED_PATHS.some(path => url.href.includes(path));
	if (isExcluded) {
		return; // Ir directo a la red
	}

	// Chunks lazy de componentes de adc-ui-library: cache-first.
	// Son assets reutilizados en muchas vistas; HMR, hot updates y lazy proxies quedan excluidos arriba.
	if (isUILibraryComponentAsset(url)) {
		event.respondWith(cacheFirst(request, UI_LIBRARY_CACHE));
		return;
	}

	// Stale-while-revalidate para traducciones i18n
	if (url.pathname.startsWith('/api/i18n')) {
		event.respondWith(staleWhileRevalidate(request, I18N_CACHE));
		return;
	}

	// En desarrollo no interceptar el runtime de app: Rspack/HMR cambia esos assets en memoria.
	if (IS_DEVELOPMENT) {
		return;
	}

	// NO cachear imágenes
	const isImage = url.pathname.match(/\\.(png|jpg|jpeg|gif|svg|ico|webp|avif)$/);
	if (isImage) {
		return; // No cachear imágenes
	}

	// Network-first para JS/CSS/HTML de apps federadas
	const isAppAsset = url.pathname.match(/\\.(js|css|html)$/) || 
		url.pathname === '/' ||
		!url.pathname.includes('.');
	
	if (isAppAsset) {
		event.respondWith(networkFirst(request, RUNTIME_CACHE));
		return;
	}

	// Fuentes: cache-first (raramente cambian)
	const isFont = url.pathname.match(/\\.(woff2?|ttf|eot)$/);
	if (isFont) {
		event.respondWith(cacheFirst(request, RUNTIME_CACHE));
		return;
	}
});

function isUILibraryComponentAsset(url) {
	return url.pathname.includes('temp_ui-builds_${namespace}_adc-ui-library_esm_') &&
		url.pathname.includes('_entry_js') &&
		url.pathname.endsWith('.js');
}

async function staleWhileRevalidate(request, cacheName) {
	const cache = await caches.open(cacheName);
	const cachedResponse = await cache.match(request);

	const fetchPromise = fetch(request)
		.then((networkResponse) => {
			if (networkResponse && networkResponse.status === 200) {
				cache.put(request, networkResponse.clone());
			}
			return networkResponse;
		})
		.catch(() => cachedResponse);

	return cachedResponse || fetchPromise;
}

async function networkFirst(request, cacheName) {
	const cache = await caches.open(cacheName);

	try {
		const networkResponse = await fetch(request);
		if (networkResponse && networkResponse.status === 200) {
			cache.put(request, networkResponse.clone());
		}
		return networkResponse;
	} catch (error) {
		const cachedResponse = await cache.match(request);
		return cachedResponse || Response.error();
	}
}

async function cacheFirst(request, cacheName) {
	const cache = await caches.open(cacheName);
	const cachedResponse = await cache.match(request);
	
	if (cachedResponse) {
		return cachedResponse;
	}
	
	try {
		const networkResponse = await fetch(request);
		if (networkResponse && networkResponse.status === 200) {
			cache.put(request, networkResponse.clone());
		}
		return networkResponse;
	} catch (error) {
		return Response.error();
	}
}

// Mensaje para precargar traducciones
self.addEventListener('message', async (event) => {
	if (event.data.type === 'PRELOAD_I18N') {
		const { locale, namespaces } = event.data;
		const cache = await caches.open(I18N_CACHE);
		
		for (const ns of (namespaces || I18N_NAMESPACES)) {
			// Usar URL relativa al origen del SW
			const url = \`/api/i18n/\${ns}?locale=\${locale}\`;
			try {
				const response = await fetch(url);
				if (response.ok) {
					await cache.put(url, response);
					console.log('[SW ${namespace}] i18n precargado:', ns, locale);
				}
			} catch (e) {
				console.warn('[SW ${namespace}] Error precargando i18n:', ns, e);
			}
		}
		
		event.source?.postMessage({ type: 'I18N_PRELOADED' });
	}
});
`;
}
