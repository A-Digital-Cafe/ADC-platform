/** Handler de fetch + estrategias de caché del Service Worker. Strings raw. */

export function buildSwFetchHandler(namespace: string): string {
	return String.raw`
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
	const isImage = url.pathname.match(/\.(png|jpg|jpeg|gif|svg|ico|webp|avif)$/);
	if (isImage) {
		return; // No cachear imágenes
	}

	// Network-first para JS/CSS/HTML de apps federadas
	const isAppAsset = url.pathname.match(/\.(js|css|html)$/) ||
		url.pathname === '/' ||
		!url.pathname.includes('.');

	if (isAppAsset) {
		event.respondWith(networkFirst(request, RUNTIME_CACHE));
		return;
	}

	// Fuentes: cache-first (raramente cambian)
	const isFont = url.pathname.match(/\.(woff2?|ttf|eot)$/);
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
`;
}

export const SW_CACHE_STRATEGIES = `
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
`;
