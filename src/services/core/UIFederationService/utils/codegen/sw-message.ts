/** Handler de mensajes del Service Worker (preload i18n). String raw. */

export function buildSwMessageHandler(namespace: string): string {
	return `
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
