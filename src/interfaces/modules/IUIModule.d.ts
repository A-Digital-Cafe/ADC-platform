/**
 * Configuración de una ruta UI para una app
 */
interface UIRouteConfig {
	/** Ruta HTTP (ej: "/", "/users", "/products/:id") */
	path: string;
	/** Página de Astro a servir (ej: "index", "users") */
	page: string;
}

/**
 * Configuración de hosting para un módulo UI en producción
 */
interface UIHostingConfig {
	/** Lista de dominios completos donde servir (ej: ["cloud.local.com"]) */
	domains: string[];
	/** Lista de subdominios o "*" para comodín (ej: ["cloud", "users", "*"]) (usa dominio por defecto del sistema) */
	subdomains?: string[];
}

interface UIModuleSecurityHeaders {
	/** Headers HTTP adicionales o overrides para el host estático del módulo */
	headers?: Record<string, string>;
}

interface UIModuleSecurityConfig {
	/** Headers comunes a todos los entornos (base sobre la que se aplican los overrides) */
	headers?: Record<string, string>;
	/** Overrides para entornos locales: `bun run dev` y `start:prodtests` (`ADC_LOCAL_PROD=true`) */
	development?: UIModuleSecurityHeaders;
	/** Overrides para producción real: `bun run start` (`NODE_ENV=production` sin `ADC_LOCAL_PROD`) */
	production?: UIModuleSecurityHeaders;
}

/**
 * Acceso mínimo para que el kernel entregue el contenido del módulo (HTML, JS, CSS y
 * cualquier estático de su host). Se evalúa ANTES de servir un solo byte: sin permiso el
 * navegador recibe un redirect a `adc-error/unauthorized` y el bundle nunca sale del server.
 *
 * No reemplaza los chequeos de los endpoints —siguen siendo la autorización real—; evita que
 * el código de un panel de administración sea material público para cualquiera que conozca
 * el subdominio.
 */
interface UIAccessConfig {
	/**
	 * Exige sesión válida sin pedir ningún rol concreto. Implícito cuando hay `roles`, así que
	 * sólo hace falta declararlo para un "cualquier usuario logueado".
	 */
	requireAuth?: boolean;
	roles?: string[];
	globalOnly?: boolean;
}

/** Coordenadas de una app contraparte (la "otra" variante responsive). */
interface UIResponsiveCounterpart {
	/** `devPort` de la contraparte (para resolver su origen en dev/LAN). */
	devPort: number;
	/** Subdominio de producción de la contraparte (ej: `m-editor`, `editor`). */
	subdomain: string;
}

/**
 * Declara que este host tiene una variante responsive aparte (típicamente una
 * app desktop y otra mobile, cada una con su propio host). UIFederationService
 * inyecta en el `<head>` un redirect que, antes de cargar el bundle, manda al
 * usuario a la `counterpart` cuando el dispositivo no coincide con `variant`
 * (heurística UA-CH/UA + viewport). El usuario puede fijar la elección con
 * `?view=desktop|mobile` (persistido); `?via=auto` evita loops (máx. 1 salto).
 */
interface UIResponsiveConfig {
	/** Rol de ESTE host: a qué clase de dispositivo sirve. */
	variant: "desktop" | "mobile";
	/** La otra variante, a la que se redirige cuando el dispositivo no coincide. */
	counterpart: UIResponsiveCounterpart;
}

/**
 * Configuración de un módulo UI en config.json
 *
 * Si el módulo tiene una carpeta `public/`, su contenido se servirá automáticamente:
 * - UI libraries (stencil): `/ui/`
 * - Otros módulos: `/pub/`
 *
 * Si tiene `uiDependencies`, también se sirven los assets públicos de esas dependencias.
 */
export interface UIModuleConfig {
	/** Nombre del módulo en el import map (sin prefijo "web-") */
	name: string;
	/** Namespace UI para agrupar módulos (ej: "default", "mobile"). Default: "default" */
	uiNamespace?: string;
	/** Framework utilizado (astro, react, vue, etc.) */
	framework?: string;
	/** Directorio de salida para el build */
	outputDir: string;
	/** @deprecated Usar isHost en su lugar. Si true, genera index.html y entry point para ejecución standalone */
	standalone?: boolean;
	/** Si true, este módulo es un host de Module Federation que consume remotes */
	isHost?: boolean;
	/** Si true, este módulo se expone como remote para ser consumido por hosts */
	isRemote?: boolean;
	/** Lista de nombres de apps UI de las que depende este módulo (deben cargarse primero) */
	uiDependencies?: string[];
	/** Puerto para dev server (solo para apps React/Vue en desarrollo) */
	devPort?: number;
	/** Rutas UI que la app expone */
	routes?: UIRouteConfig[];
	/** Librerías compartidas que este módulo usa (ej: ["react", "vue"]) */
	sharedLibs?: string[];
	/** Configuración personalizada de Astro */
	astroConfig?: Record<string, any>;
	/** Habilita i18n para esta app (lee archivos de /i18n/*.js) */
	i18n?: boolean;
	/** Habilita service worker con cache stale-while-revalidate */
	serviceWorker?: boolean;
	/** Exports que este módulo expone globalmente (ej: { "loader": "./loader", "utils": "./utils" }) */
	exports?: Record<string, string>;
	/**
	 * Sólo UI libraries (Stencil con `exports`): declara que ESTA es la library raíz de su
	 * namespace, la que se queda con los aliases legacy `@ui-library*` en los módulos que
	 * declaran más de una. Sin esto el dueño del alias sería el primer elemento de
	 * `uiDependencies`, y reordenar el array cambiaría a qué library resuelve
	 * `@ui-library/utils` sin ningún error (ambas exportan un dir `utils`).
	 */
	isPrimaryUILibrary?: boolean;
	/**
	 * Sólo consumidores: fija por NOMBRE qué UI library se queda con los aliases legacy
	 * `@ui-library*`. Gana sobre `isPrimaryUILibrary`. Sirve para el caso raro de un módulo
	 * que quiere apuntar el alias legacy a una library secundaria.
	 */
	uiLibraryAlias?: string;
	/** Exposes para Module Federation (ej: { "./App": "./src/App.tsx", "./Header": "./src/Header.tsx" }) */
	federationExposes?: Record<string, string>;
	/** Configuración de hosting para producción (dominios/subdominios) */
	hosting?: UIHostingConfig[];
	/** Seguridad HTTP específica para el módulo UI */
	security?: UIModuleSecurityConfig;
	/** Roles mínimos para que el kernel entregue el contenido de este módulo */
	access?: UIAccessConfig;
	/**
	 * Acceso mínimo por `expose` de Module Federation: clave del expose → roles.
	 *
	 * Los remotes se sirven desde el host de quien los EXPONE, no desde el del consumidor, así
	 * que un panel de administración federado desde una app pública (el de moderación de Drive)
	 * quedaría descargable aunque el panel que lo consume esté protegido. Esto gatea el chunk
	 * del expose en su propio host. `access` no sirve para el caso: cerraría la app entera.
	 *
	 * Sólo protege el chunk del expose, no las dependencias compartidas (que no llevan la
	 * lógica del panel). El `remoteEntry.js` sigue nombrando el expose: se oculta el código,
	 * no su existencia.
	 */
	federationAccess?: Record<string, UIAccessConfig>;
	/**
	 * Habilita inyección de metadatos SEO en las respuestas HTML
	 * de este módulo. Requiere que `SEOService` esté cargado y que
	 * la app llame a `seoService.registerPageMeta(...)`.
	 */
	enableSEO?: boolean;
	/** Variante responsive (desktop/mobile) y su contraparte para auto-redirect. */
	responsive?: UIResponsiveConfig;
}

/**
 * Entrada en el import map
 */
interface ImportMapEntry {
	/** Clave en el import map (ej: "ui-library", "react") */
	key: string;
	/** URL o path del módulo (ej: "/ui/ui-library/index.js") */
	url: string;
}

/**
 * Estructura completa del import map
 */
export interface ImportMap {
	imports: Record<string, string>;
	scopes?: Record<string, Record<string, string>>;
}
