import type { UIModuleConfig } from "../../../../interfaces/modules/IUIModule.js";

export type SitemapChangeFreq = "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";

export interface SitemapEntry {
	path: string;
	lastmod?: string | Date;
	changefreq?: SitemapChangeFreq;
	priority?: number;
}

export type SitemapPath = string | SitemapEntry;
export type SitemapPathSource = SitemapPath[] | (() => SitemapPath[] | Promise<SitemapPath[]>);

export interface RegisterSitemapOptions {
	appName: string;
	hosting?: UIModuleConfig["hosting"];
	paths: SitemapPathSource;
	/**
	 * Directorio raíz del módulo. Si se provee, su `mtime` se usa como
	 * `lastmod` por defecto para las entradas que no declaren uno propio.
	 */
	appDir?: string;
	/**
	 * Marca los hosts de esta registración como índices de sitemaps.
	 * En estos hosts `/sitemap.xml` devuelve un `<sitemapindex>` que enlaza:
	 *   - `/sitemaps/main.xml` con las URLs propias del host índice.
	 *   - `/sitemap.xml` de los hosts hermanos (mismo dominio base).
	 */
	isIndex?: boolean;
}

export interface OgImageMeta {
	url: string;
	width?: number;
	height?: number;
	alt?: string;
}

export interface OgMeta {
	title?: string;
	description?: string;
	type?: string;
	url?: string;
	siteName?: string;
	locale?: string;
	image?: OgImageMeta;
}

export interface TwitterMeta {
	card?: "summary" | "summary_large_image" | "app" | "player";
	title?: string;
	description?: string;
	image?: string;
	site?: string;
	creator?: string;
}

export interface ArticleMeta {
	publishedTime?: string | Date;
	modifiedTime?: string | Date;
	author?: string | string[];
	section?: string;
	tag?: string | string[];
}

export interface PageMeta {
	title?: string;
	/** Plantilla con `%s` reemplazado por `title`. */
	titleTemplate?: string;
	description?: string;
	/** URL absoluta o ruta absoluta. Si es ruta, se prefija con el origin actual. */
	canonical?: string;
	robots?: string;
	og?: OgMeta;
	twitter?: TwitterMeta;
	article?: ArticleMeta;
	jsonLd?: object | object[];
	extra?: Array<{ tag: "meta" | "link"; attrs: Record<string, string> }>;
}

export interface PageMetaResolverContext {
	host: string;
	path: string;
	params: Record<string, string>;
}

export type PageMetaResolver = (ctx: PageMetaResolverContext) => PageMeta | null | Promise<PageMeta | null>;

export interface PageMetaEntry {
	path: string;
	meta: PageMeta | PageMetaResolver;
	/** TTL (ms) para resultados resueltos por callbacks. Default 5min. */
	cacheTtlMs?: number;
}

export interface RegisterPageMetaOptions {
	appName: string;
	hosting?: UIModuleConfig["hosting"];
	pages: PageMetaEntry[];
	defaults?: PageMeta;
}

export interface CompiledEntry {
	exact: boolean;
	path: string;
	regex: RegExp;
	paramNames: string[];
	meta: PageMeta | PageMetaResolver;
	cacheTtlMs: number;
}

export interface HostSEOState {
	enabled: boolean;
	defaults: PageMeta;
	exact: Map<string, CompiledEntry>;
	patterns: CompiledEntry[];
}

export interface SitemapRegistration {
	appName: string;
	source: SitemapPathSource;
	/** Directorio del módulo, usado para resolver `lastmod` por defecto. */
	appDir?: string;
}

export interface CachedRender {
	tags: string;
	expires: number;
}
