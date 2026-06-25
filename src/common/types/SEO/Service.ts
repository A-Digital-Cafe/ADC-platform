/**
 * Contrato público del SEOService.
 *
 * Vive en `src/common/types` para que las apps y el resto de servicios del
 * núcleo puedan referenciarlo sin depender físicamente del módulo `SEOService`
 * (que ahora vive como preset opcional en `presets/SEO/`).
 *
 * Sólo los tipos consumidos desde fuera del módulo se exponen aquí.
 * Los tipos internos (cache, estado por host, registración, etc.) viven
 * junto a la implementación.
 */

import type { UIModuleConfig } from "../../../interfaces/modules/IUIModule.js";
import type { Capability } from "../../security/Capability.js";

// ============ Sitemap ============

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

// ============ Page Meta ============

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

/**
 * Branding para la autogeneración de OG images cuando una página no declara
 * `og.image`. Las apps lo pasan en `defaults.ogBrand` al registrar su SEO.
 */
export interface OgBrandConfig {
	/** Color de fondo de la imagen (CSS color). Default `#ffffff`. */
	background?: string;
	/** Color del texto principal (CSS color). Default `#1a1a1a`. */
	color?: string;
	/** URL absoluta del logo a renderizar al pie. */
	logoUrl?: string;
	/** Nombre de marca mostrado junto al logo. */
	brandName?: string;
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
	/**
	 * Branding para autogenerar una OG image si `og` existe pero `og.image` no.
	 * El SEOService genera un PNG 1200x630 servido en `/_og/:file`.
	 */
	ogBrand?: OgBrandConfig;
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

// ============ llms.txt ============

export interface LlmsLink {
	title: string;
	description?: string;
	href: string;
}

export interface LlmsSection {
	title: string;
	description?: string;
	links: LlmsLink[];
}

export interface LlmsContext {
	host: string;
	origin: string;
}

export type LlmsSectionsSource = LlmsSection[] | ((ctx: LlmsContext) => LlmsSection[] | Promise<LlmsSection[]>);

export interface RegisterLlmsOptions {
	appName: string;
	hosting?: UIModuleConfig["hosting"];
	/** Título principal del documento (`# title`). */
	title: string;
	/** Descripción corta (`> description`). */
	description?: string;
	/** Secciones con enlaces curados para LLMs. */
	sections: LlmsSectionsSource;
	/** TTL de caché del documento generado (ms). Default 5min. */
	cacheTtlMs?: number;
}

// ============ Provider de Fastify (referencia laxa) ============

/**
 * Subconjunto mínimo del FastifyServerProvider que el SEOService necesita
 * para enganchar el hook de inyección. Se tipa de forma laxa para evitar
 * que el contrato público dependa del módulo concreto del provider.
 */
export interface ISeoFastifyProvider {
	getApp(token: Capability): { addHook(name: "onSend", handler: (...args: any[]) => any): void };
	registerHostRoute(host: string, method: string, path: string, handler: (...args: any[]) => any): void;
}

// ============ Contrato del servicio ============

/**
 * Interfaz pública del SEOService. Permite que apps y servicios la consuman
 * sin acoplarse a la implementación (que vive en el preset opcional `SEO`).
 *
 * Si el servicio no está disponible (preset no instalado), `getMyService`
 * lanzará y el llamante debe degradar silenciosamente.
 */
export interface ISEOService {
	registerOnSitemap(options: RegisterSitemapOptions): void;
	registerPageMeta(options: RegisterPageMetaOptions): void;
	registerLlms(options: RegisterLlmsOptions): void;
	enableForHosts(hostPatterns: string[], options?: { defaults?: PageMeta }): void;
	attachFastify(provider: ISeoFastifyProvider): void;
}
