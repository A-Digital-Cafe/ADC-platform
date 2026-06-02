/**
 * Builder transversal de Schema.org (`application/ld+json`) para los
 * microfronts de ADC.
 *
 * Lo común a toda la plataforma (origen, logo, idioma, brand name y perfiles
 * sociales) vive aquí. Cada microfront crea su propio builder con
 * `createSeoGraph()` aportando lo que varía (p.ej. `siteName` o la plantilla de
 * búsqueda) y genera su JSON-LD base a partir de él.
 */

/** Configuración de marca compartida por todos los microfronts. */
export interface SeoBrand {
	/** Origen absoluto del sitio, sin slash final. Ej: `https://adigitalcafe.com`. */
	origin: string;
	/** Nombre de la marca / organización. */
	brandName: string;
	/** URL absoluta del logo. */
	logoUrl: string;
	/** Idioma BCP-47. Ej: `es-419`. */
	inLanguage: string;
	/** Perfiles sociales (`schema.org` `sameAs`). */
	sameAs: string[];
	/** Descripción larga de la marca (`WebSite.description`). */
	description?: string;
}

/** Configuración del sitio: marca + ajustes que cada microfront puede variar. */
export interface SeoSiteConfig extends SeoBrand {
	/** Nombre del `WebSite` (por defecto `brandName`). */
	siteName?: string;
	/** Plantilla `urlTemplate` del `SearchAction`. Si se omite, no se añade. */
	searchUrlTemplate?: string;
}

/** Datos para un nodo `Article`. */
export interface ArticleGraphInput {
	path: string;
	title: string;
	description?: string;
	imageUrl?: string;
	createdAt?: string | Date;
	updatedAt?: string | Date;
	section?: string;
}

/**
 * Marca por defecto de ADC. Los microfronts la reutilizan vía
 * `createSeoGraph(ADC_BRAND)` y sólo sobreescriben lo que cambie.
 */
export const ADC_BRAND: SeoSiteConfig = {
	origin: "https://adigitalcafe.com",
	brandName: "Abby's Digital Cafe",
	description:
		"Abby's Digital Cafe es una comunidad destinada a programadores y estudiantes, enfocada en aprender nuevas tecnologías y compartir código de forma libre 🧡",
	inLanguage: "es-419",
	logoUrl: "https://adigitalcafe.com/logo.webp",
	sameAs: [
		"https://discord.com/invite/vShXpyWTTq",
		"https://twitch.tv/digital_cafe",
		"https://youtube.com/@a_digital_cafe",
		"https://github.com/abbytec",
	],
	searchUrlTemplate: "https://adigitalcafe.com/articles?q={search_term_string}",
};

/** API que devuelve `createSeoGraph()` ya enlazada a una marca concreta. */
export interface SeoGraphBuilder {
	/** Nodos de identidad/organización/logo compartidos. */
	brandNodes(): object[];
	/** Nodo `WebSite` (con `SearchAction` si hay plantilla). */
	websiteNode(): object;
	/** Nodo `WebPage` para una ruta. */
	webPageNode(path: string, name: string, description?: string): object;
	/** Nodo `Article`. */
	articleNode(input: ArticleGraphInput): object;
	/** Grafo para una página estándar (home, listados, learning paths…). */
	buildPageGraph(path: string, name: string, description?: string): object;
	/** Grafo para un artículo, añadiendo el nodo `Article`. */
	buildArticleGraph(input: ArticleGraphInput): object;
}

function toIso(value?: string | Date): string | undefined {
	if (!value) return undefined;
	return value instanceof Date ? value.toISOString() : value;
}

/**
 * Crea un builder de JSON-LD enlazado a la configuración de un microfront.
 * Reutiliza nodos transversales (identidad, organización, logo, website) y
 * permite generar grafos de página o de artículo.
 */
export function createSeoGraph(config: SeoSiteConfig): SeoGraphBuilder {
	const { origin, brandName, logoUrl, inLanguage, sameAs, description } = config;
	const siteName = config.siteName ?? brandName;

	const cleanPath = (path: string): string => (path !== "/" && path.endsWith("/") ? path.slice(0, -1) : path);
	const pageUrl = (path: string): string => `${origin}${cleanPath(path)}`;

	const brandNodes = (): object[] => [
		{ "@id": `${origin}/#identity`, "@type": "Organization", name: brandName, url: origin, sameAs },
		{ "@id": `${origin}/#logo`, "@type": "ImageObject", caption: brandName, contentUrl: logoUrl, inLanguage, url: logoUrl },
		{ "@id": `${origin}/#organization`, "@type": "Organization", logo: logoUrl, name: brandName, url: origin, sameAs },
	];

	const websiteNode = (): object => ({
		"@id": `${origin}/#website`,
		"@type": "WebSite",
		...(description ? { description } : {}),
		inLanguage,
		name: siteName,
		url: `${origin}/`,
		...(config.searchUrlTemplate
			? {
					potentialAction: [
						{
							"@type": "SearchAction",
							target: { "@type": "EntryPoint", urlTemplate: config.searchUrlTemplate },
							"query-input": { "@type": "PropertyValueSpecification", valueRequired: true, valueName: "search_term_string" },
						},
					],
				}
			: {}),
		publisher: { "@id": `${origin}/#identity` },
	});

	const webPageNode = (path: string, name: string, desc?: string): object => {
		const url = pageUrl(path);
		return {
			"@id": `${url}#webpage`,
			"@type": "WebPage",
			name,
			...(desc ? { description: desc } : {}),
			url,
			about: { "@id": `${origin}/#identity` },
			isPartOf: { "@id": `${origin}/#website` },
			primaryImageOfPage: { "@id": `${origin}/#logo` },
		};
	};

	const articleNode = (input: ArticleGraphInput): object => {
		const url = pageUrl(input.path);
		return {
			"@id": `${url}#article`,
			"@type": "Article",
			headline: input.title,
			...(input.description ? { description: input.description } : {}),
			image: input.imageUrl ?? logoUrl,
			...(input.section ? { articleSection: input.section } : {}),
			...(toIso(input.createdAt) ? { datePublished: toIso(input.createdAt) } : {}),
			...(toIso(input.updatedAt) ? { dateModified: toIso(input.updatedAt) } : {}),
			inLanguage,
			url,
			isPartOf: { "@id": `${url}#webpage` },
			mainEntityOfPage: { "@id": `${url}#webpage` },
			author: { "@id": `${origin}/#identity` },
			publisher: { "@id": `${origin}/#organization` },
		};
	};

	const graph = (nodes: object[]): object => ({ "@context": "https://schema.org", "@graph": nodes });

	return {
		brandNodes,
		websiteNode,
		webPageNode,
		articleNode,
		buildPageGraph: (path, name, desc) => graph([websiteNode(), webPageNode(path, name, desc), ...brandNodes()]),
		buildArticleGraph: (input) =>
			graph([websiteNode(), webPageNode(input.path, input.title, input.description), articleNode(input), ...brandNodes()]),
	};
}
