/**
 * Tutoriales de plataforma — descubrimiento y carga.
 *
 * Convención (desacoplada, sin Module Federation): cada microfront publica sus
 * tutoriales como archivos estáticos en su carpeta `public/tutorials/`:
 *
 *   public/tutorials/index.json   ← manifiesto (ver `TutorialIndex`)
 *   public/tutorials/<slug>.md    ← un markdown breve por tutorial
 *
 * Esos archivos se sirven en el propio origen de la app (devServer en dev,
 * output del build por host en prod), por lo que cualquier app puede
 * descubrirlos sondeando `{origen}/tutorials/index.json` para cada app del
 * registry de `platform-links`. Una app sin tutoriales simplemente no tiene el
 * manifiesto (404 o fallback SPA) y se omite sin error.
 *
 * El markdown se renderiza con `markdownToBlocks()` + `adc-blocks-renderer`,
 * heredando estilos, sanitización de links y chips `adc-platform-link`.
 */

import { getPlatformAppOrigin, getPlatformApps, type PlatformApp } from "./platform-links.js";

/** Metadatos de un tutorial dentro del manifiesto de una app. */
export interface TutorialMeta {
	/** Identificador estable; el markdown vive en `tutorials/<slug>.md`. */
	slug: string;
	/** Título visible (el .md no repite el título como `#`). */
	title: string;
	/** Resumen de una línea para listados. */
	description?: string;
	/** Minutos estimados de lectura. */
	minutes?: number;
}

/** Forma de `public/tutorials/index.json`. */
interface TutorialIndex {
	tutorials: TutorialMeta[];
}

/** Tutoriales descubiertos de una app concreta. */
export interface AppTutorials {
	app: PlatformApp;
	tutorials: TutorialMeta[];
}

interface TutorialsRegistry {
	indexCache: Map<string, Promise<TutorialMeta[]>>;
	markdownCache: Map<string, Promise<string | null>>;
}

const REGISTRY_KEY = Symbol.for("adc.tutorials.registry");

/** Caché compartida entre el runtime de la UI library y el bundle del host. */
function getRegistry(): TutorialsRegistry {
	const g = globalThis as Record<symbol, unknown>;
	let registry = g[REGISTRY_KEY] as TutorialsRegistry | undefined;
	if (!registry) {
		registry = { indexCache: new Map(), markdownCache: new Map() };
		g[REGISTRY_KEY] = registry;
	}
	return registry;
}

function isValidMeta(value: unknown): value is TutorialMeta {
	if (!value || typeof value !== "object") return false;
	const meta = value as Partial<TutorialMeta>;
	// El slug se interpola en URLs: solo identificadores simples.
	return typeof meta.title === "string" && typeof meta.slug === "string" && /^[a-z0-9][a-z0-9-]*$/i.test(meta.slug);
}

/**
 * Manifiesto de tutoriales de una app, o `[]` si no publica ninguno. Tolera
 * 404, fallback SPA (HTML en vez de JSON), errores de red y JSON malformado.
 */
export function fetchAppTutorials(app: PlatformApp): Promise<TutorialMeta[]> {
	const registry = getRegistry();
	const cached = registry.indexCache.get(app.id);
	if (cached) return cached;

	const promise = (async (): Promise<TutorialMeta[]> => {
		try {
			const res = await fetch(`${getPlatformAppOrigin(app)}/tutorials/index.json`, {
				headers: { Accept: "application/json" },
			});
			if (!res.ok) return [];
			// El fallback SPA responde 200 con index.html: descartar lo que no sea JSON.
			const contentType = res.headers.get("content-type") || "";
			if (!contentType.includes("json")) return [];
			const data = (await res.json()) as Partial<TutorialIndex>;
			if (!Array.isArray(data?.tutorials)) return [];
			return data.tutorials.filter((t) => isValidMeta(t));
		} catch {
			return [];
		}
	})();

	registry.indexCache.set(app.id, promise);
	return promise;
}

/**
 * Catálogo completo: sondea en paralelo todas las apps conocidas del registry
 * de plataforma y devuelve solo las que publican tutoriales, en el orden del
 * registry.
 */
export async function fetchTutorialsCatalog(): Promise<AppTutorials[]> {
	const apps = getPlatformApps();
	const results = await Promise.all(apps.map(async (app) => ({ app, tutorials: await fetchAppTutorials(app) })));
	return results.filter((entry) => entry.tutorials.length > 0);
}

/**
 * Markdown crudo de un tutorial, o `null` si no existe. Mismo criterio
 * tolerante que el manifiesto (el fallback SPA devuelve HTML → `null`).
 */
export function fetchTutorialMarkdown(app: PlatformApp, slug: string): Promise<string | null> {
	const registry = getRegistry();
	const key = `${app.id}/${slug}`;
	const cached = registry.markdownCache.get(key);
	if (cached) return cached;

	const promise = (async (): Promise<string | null> => {
		if (!/^[a-z0-9][a-z0-9-]*$/i.test(slug)) return null;
		try {
			const res = await fetch(`${getPlatformAppOrigin(app)}/tutorials/${slug}.md`, {
				headers: { Accept: "text/markdown, text/plain" },
			});
			if (!res.ok) return null;
			const contentType = res.headers.get("content-type") || "";
			if (contentType.includes("html")) return null;
			return await res.text();
		} catch {
			return null;
		}
	})();

	registry.markdownCache.set(key, promise);
	return promise;
}
