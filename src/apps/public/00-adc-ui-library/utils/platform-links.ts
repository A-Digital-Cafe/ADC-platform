/**
 * Platform link resolver.
 *
 * Detecta a qué microfront apunta una URL usando la misma convención que
 * `adc-apps-menu`/`getUrl`: por **puerto** en desarrollo (localhost) y por
 * **subdominio** en producción. Cuando un enlace resuelve a una app conocida,
 * obtiene un título legible para la entidad destino (artículo, tarea,
 * tablero…) mediante *resolvers* que cada app **expone como remote de Module
 * Federation** vía `federationExposes` en su `config.json`.
 *
 * La lista de apps conocidas vive aquí (`DEFAULT_APPS`). Para enriquecer un
 * enlace, el chip carga **bajo demanda** el resolver federado de la app destino
 * (su `remoteEntry.js`), aunque esa app nunca se haya abierto en la sesión
 * actual. Así un enlace a un artículo de Community se resuelve igual desde
 * Project Management. Si la carga remota falla, se degrada al título por
 * defecto (ruta legible) sin romper el render.
 *
 * El singleton sobre `globalThis` comparte apps, resolvers cacheados, cargas
 * en vuelo y la caché de resoluciones entre el runtime de la UI library (donde
 * corre el chip) y el bundle del app host.
 */

export interface PlatformApp {
	/** Identificador estable (ej: `community`, `projects`). */
	id: string;
	/** Nombre visible del microfront (ej: `Community`). */
	label: string;
	/** Puerto de desarrollo (`devPort` del `config.json`). */
	devPort: number;
	/** Subdominio de producción (ej: `community`). */
	subdomain: string;
	/** Tag del icono de app, si existe (ej: `adc-icon-app-community`). */
	iconTag?: string;
	/**
	 * Nombre del contenedor Module Federation (el `name` del `config.json` con
	 * `-` → `_`, ej: `community-home` → `community_home`). Necesario para cargar
	 * el resolver federado de la app.
	 */
	remoteName?: string;
	/**
	 * Clave del módulo expuesto en `federationExposes` que default-exporta un
	 * `PlatformLinkResolver` (ej: `./platformLinkResolver`). Si está ausente, la
	 * app no aporta títulos enriquecidos y se usa el fallback por defecto.
	 */
	resolverExpose?: string;
	/**
	 * Clave del módulo expuesto en `federationExposes` que default-exporta un panel
	 * de **configuración de cuenta** (ej. preferencias de notificación de la app),
	 * consumido por el host `my-account` vía Module Federation (`./AccountSettings`).
	 * Si está ausente, la app no aporta panel; si la app está offline, su panel
	 * simplemente no se muestra (la carga remota degrada sin romper el resto).
	 */
	settingsExpose?: string;
	/**
	 * Clave del módulo expuesto en `federationExposes` que default-exporta el **menú
	 * del header** de la app con contrato vanilla `mount(container, props) → unmount`
	 * (ej. `./NotificationsMenu`, consumido por `adc-notification-bell`). Si la app
	 * está offline, el host degrada (la campana avisa con un toast al abrir).
	 */
	headerMenuExpose?: string;
	/**
	 * Hostname de producción del `remoteEntry.js` (ej: `community.adigitalcafe.com`).
	 * Por defecto se deriva como `{subdomain}.adigitalcafe.com`.
	 */
	prodHostname?: string;
}

type PlatformLinkStatus = "ok" | "denied" | "missing" | "error";

/** @public Referencia resuelta de un enlace de plataforma (app + ruta parseada). */
export interface PlatformLinkRef {
	app: PlatformApp;
	/** URL absoluta normalizada. */
	url: string;
	/** Pathname (`/articles/foo`). */
	path: string;
	/** Segmentos no vacíos del path (`["articles", "foo"]`). */
	segments: string[];
	/** Query params. */
	query: URLSearchParams;
	/** Fragmento (`#seccion`), sin el `#`. */
	hash: string;
}

/** Información lista para pintar el chip estilo Jira / Google Docs. */
export interface PlatformLinkInfo {
	appId: string;
	/** Nombre del microfront. */
	appLabel: string;
	iconTag?: string;
	/** Título de la entidad (o ruta legible como fallback). */
	title: string;
	/** Texto secundario (ej: tablero / organización). */
	subtitle?: string;
	href: string;
	status: PlatformLinkStatus;
}

/**
 * @public Resolver de título para una app. Recibe la referencia parseada y devuelve los
 * campos de `PlatformLinkInfo` que conozca (normalmente `title`, `subtitle` y
 * opcionalmente `status: "denied"` si el usuario no tiene acceso). Puede ser
 * asíncrono (fetch a servicios). Devolver `null` deja el fallback por defecto.
 *
 * Cada app expone su resolver como **default export** de un módulo declarado en
 * `federationExposes` (ej: `"./platformLinkResolver": "./src/utils/..."`).
 */
export type PlatformLinkResolver = (ref: PlatformLinkRef) => Promise<Partial<PlatformLinkInfo> | null> | Partial<PlatformLinkInfo> | null;

interface PlatformLinkRegistry {
	apps: Map<string, PlatformApp>;
	/** Resolvers ya cargados (en proceso o cacheados desde su remote). */
	resolvers: Map<string, PlatformLinkResolver>;
	/** Cargas de resolver federado en vuelo (dedupe por appId). */
	loading: Map<string, Promise<PlatformLinkResolver | null>>;
	cache: Map<string, Promise<PlatformLinkInfo | null>>;
}

const REGISTRY_KEY = Symbol.for("adc.platform-links.registry");

/** Dominio base de producción para derivar el `remoteEntry.js` de cada app. */
const PROD_BASE_DOMAIN = "adigitalcafe.com";

/**
 * Apps conocidas por defecto (sincronizado con los `config.json` / `docs/guides/ports.csv`).
 * `remoteName` = `name` del `config.json` con `-` → `_`. `resolverExpose` solo en
 * apps cuyo `config.json` declara el resolver en `federationExposes`.
 */
const DEFAULT_APPS: PlatformApp[] = [
	{
		id: "home",
		label: "Abby's Digital Cafe",
		devPort: 3024,
		// Vive en el apex (sin subdominio): se matchea por `prodHostname`.
		subdomain: "",
		prodHostname: PROD_BASE_DOMAIN,
	},
	{ id: "auth", label: "Auth", devPort: 3012, subdomain: "auth", iconTag: "adc-icon-app-auth" },
	{
		id: "community",
		label: "Community",
		devPort: 3010,
		subdomain: "community",
		iconTag: "adc-icon-app-community",
		remoteName: "community_home",
		resolverExpose: "./platformLinkResolver",
	},
	{
		id: "projects",
		label: "Projects",
		devPort: 3018,
		subdomain: "projects",
		iconTag: "adc-icon-app-projects",
		remoteName: "adc_project_manager",
		resolverExpose: "./platformLinkResolver",
	},
	{ id: "identity", label: "Identity", devPort: 3014, subdomain: "identity", iconTag: "adc-icon-app-identity", remoteName: "adc_identity" },
	{
		id: "drive",
		label: "Drive",
		devPort: 3032,
		subdomain: "drive",
		iconTag: "adc-icon-app-drive",
		remoteName: "adc_drive",
		settingsExpose: "./AccountSettings",
	},
	{ id: "editor", label: "Image Editor", devPort: 3034, subdomain: "editor" },
	{ id: "mail", label: "Mail", devPort: 3030, subdomain: "mail", iconTag: "adc-icon-app-mail" },
	{ id: "modules", label: "Modules Manager", devPort: 3038, subdomain: "modules" },
	{ id: "help", label: "Help", devPort: 3022, subdomain: "help", iconTag: "adc-icon-app-help" },
	{ id: "my-account", label: "My Account", devPort: 3016, subdomain: "my-account", iconTag: "adc-icon-app-myaccount" },
	{
		id: "notifications",
		label: "Notificaciones",
		devPort: 3036,
		subdomain: "notifications",
		remoteName: "adc_notifications",
		headerMenuExpose: "./NotificationsMenu",
	},
	{ id: "org", label: "Organizations", devPort: 3028, subdomain: "org", iconTag: "adc-icon-app-org" },
	{ id: "status", label: "Status", devPort: 3020, subdomain: "status", iconTag: "adc-icon-app-status" },
];

function getRegistry(): PlatformLinkRegistry {
	const g = globalThis as Record<symbol, unknown>;
	let registry = g[REGISTRY_KEY] as PlatformLinkRegistry | undefined;
	if (!registry) {
		registry = {
			apps: new Map(DEFAULT_APPS.map((a) => [a.id, a])),
			resolvers: new Map(),
			loading: new Map(),
			cache: new Map(),
		};
		g[REGISTRY_KEY] = registry;
	}
	return registry;
}

/** Lista las apps de plataforma conocidas. */
export function getPlatformApps(): PlatformApp[] {
	return Array.from(getRegistry().apps.values());
}

/** Una app de plataforma por su id (`community`, `notifications`, …), o `null`. */
export function getPlatformApp(id: string): PlatformApp | null {
	return getRegistry().apps.get(id) ?? null;
}

/**
 * Resuelve una ruta dentro de una app de plataforma a una URL **absoluta válida en
 * el entorno actual**: en desarrollo usa el `devPort` (`http://localhost:3018/...`),
 * en producción el subdominio (`https://projects.adigitalcafe.com/...`). Pensado para
 * los enlaces de notificaciones (se guardan como `appId` + `path`, no como URL fija).
 * Devuelve `null` si el `appId` no es una app conocida (el caller cae al fallback).
 */
export function resolvePlatformPath(appId: string, path: string): string | null {
	const app = getRegistry().apps.get(appId);
	if (!app) return null;
	const pathStr = path.startsWith("/") ? path : `/${path}`;
	const suffix = path ? pathStr : "";
	return `${getPlatformAppOrigin(app)}${suffix}`;
}

/**
 * Apps que exponen un panel federado de configuración de cuenta
 * (`settingsExpose` + `remoteName`). El host `my-account` itera esta lista y
 * carga el panel de cada una bajo demanda; las que estén offline se omiten.
 */
export function getAccountSettingsApps(): PlatformApp[] {
	return getPlatformApps().filter((a) => !!a.settingsExpose && !!a.remoteName);
}

/** Limpia la caché de resoluciones (ej: tras cambiar de sesión/permisos). */
export function clearPlatformLinkCache(): void {
	getRegistry().cache.clear();
}

/** localhost, 127.0.0.1 o IPv4 privada/LAN. */
function isPrivateHostname(hostname: string): boolean {
	if (hostname === "localhost" || hostname === "127.0.0.1") return true;
	if (hostname.startsWith("192.168.")) return true;
	if (hostname.startsWith("10.")) return true;
	return /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
}

function findApp(hostname: string, portStr: string): PlatformApp | null {
	const apps = getRegistry().apps;
	if (isPrivateHostname(hostname)) {
		const port = Number(portStr);
		if (!Number.isFinite(port) || port === 0) return null;
		for (const app of apps.values()) if (app.devPort === port) return app;
		return null;
	}
	const normalized = hostname.toLowerCase();
	// Apps en el apex (sin subdominio, ej: home) se matchean por hostname completo.
	for (const app of apps.values()) if (app.prodHostname?.toLowerCase() === normalized) return app;
	const subdomain = normalized.split(".")[0];
	if (!subdomain) return null;
	for (const app of apps.values()) if (app.subdomain && app.subdomain === subdomain) return app;
	return null;
}

/**
 * Resuelve una URL (absoluta o relativa) a una referencia de plataforma, o
 * `null` si no apunta a ningún microfront conocido (enlace externo).
 */
function resolvePlatformLink(rawUrl: string): PlatformLinkRef | null {
	if (!rawUrl) return null;
	let u: URL;
	try {
		u = new URL(rawUrl, globalThis.location?.href);
	} catch {
		return null;
	}
	if (u.protocol !== "http:" && u.protocol !== "https:") return null;
	const app = findApp(u.hostname, u.port);
	if (!app) return null;
	const segments = u.pathname.split("/").filter(Boolean).map(decodeSegment);
	return {
		app,
		url: u.href,
		path: u.pathname,
		segments,
		query: u.searchParams,
		hash: u.hash.replace(/^#/, ""),
	};
}

function decodeSegment(seg: string): string {
	try {
		return decodeURIComponent(seg);
	} catch {
		return seg;
	}
}

/** `true` si la URL apunta a un microfront conocido de la plataforma. */
export function isPlatformLink(rawUrl: string): boolean {
	return resolvePlatformLink(rawUrl) !== null;
}

/** Convierte un slug/segmento en un título legible: `mi-articulo` → `Mi articulo`. */
function humanize(segment: string): string {
	const text = segment
		.replace(/[-_]+/g, " ")
		.replace(/\.[a-z0-9]+$/i, "")
		.trim();
	if (!text) return "";
	return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Título por defecto a partir de la ruta cuando no hay resolver específico. */
function defaultTitle(ref: PlatformLinkRef): string {
	const last = ref.segments.length > 0 ? ref.segments[ref.segments.length - 1] : "";
	if (!last) return "Inicio";
	return humanize(last) || ref.app.label;
}

function buildBaseInfo(ref: PlatformLinkRef): PlatformLinkInfo {
	return {
		appId: ref.app.id,
		appLabel: ref.app.label,
		iconTag: ref.app.iconTag,
		title: defaultTitle(ref),
		href: ref.url,
		status: "ok",
	};
}

/**
 * Origen (protocolo + host + puerto, sin slash final) de una app de plataforma
 * visto desde la página actual: en dev por `devPort`, en prod por subdominio.
 * Bajo HTTPS los recursos remotos van por https (evita MITM y mixed content);
 * protocolo y puerto se heredan de la página actual (prod real: https sin
 * puerto; start:prodtests: http con puerto 3000).
 */
export function getPlatformAppOrigin(app: PlatformApp): string {
	const hostname = globalThis.location?.hostname ?? "localhost";
	if (isPrivateHostname(hostname)) return `http://${hostname}:${app.devPort}`;
	const prodHost = app.prodHostname ?? `${app.subdomain}.${PROD_BASE_DOMAIN}`;
	const protocol = globalThis.location?.protocol === "https:" ? "https" : "http";
	const port = globalThis.location?.port;
	const portTxt = port ? `:${port}` : "";
	return `${protocol}://${prodHost}${portTxt}`;
}

/** URL del `remoteEntry.js` de una app (dev: por puerto; prod: por subdominio). */
function remoteEntryUrl(app: PlatformApp): string {
	return `${getPlatformAppOrigin(app)}/remoteEntry.js`;
}

/** Inyecta una sola vez el script `remoteEntry.js` de un contenedor federado. */
function loadRemoteEntryScript(url: string, remoteName: string): Promise<void> {
	if (typeof document === "undefined") return Promise.reject(new Error("no-dom"));
	const existing = document.querySelector<HTMLScriptElement>(`script[data-platform-remote="${remoteName}"]`);
	if (existing) {
		if (existing.dataset.loaded === "true") return Promise.resolve();
		return new Promise((resolve, reject) => {
			existing.addEventListener("load", () => resolve(), { once: true });
			existing.addEventListener("error", () => reject(new Error(`remoteEntry failed: ${url}`)), { once: true });
		});
	}
	return new Promise((resolve, reject) => {
		const script = document.createElement("script");
		script.src = url;
		script.async = true;
		script.dataset.platformRemote = remoteName;
		script.addEventListener("load", () => {
			script.dataset.loaded = "true";
			resolve();
		});
		script.addEventListener("error", () => reject(new Error(`remoteEntry failed: ${url}`)));
		document.head.appendChild(script);
	});
}

interface FederationContainer {
	init: (shareScope: unknown) => Promise<void> | void;
	get: (module: string) => Promise<() => unknown>;
}

/**
 * Carga bajo demanda un módulo federado de una app (inyecta su `remoteEntry.js`,
 * inicializa el contenedor y resuelve la clave de `federationExposes`). Devuelve
 * el **default export** del módulo (o el módulo mismo si no lo tiene). Degrada a
 * `null` ante cualquier fallo —SSR, app offline, expose ausente o error de red—.
 */
export async function loadPlatformRemoteModule<T>(app: PlatformApp, expose: string): Promise<T | null> {
	if (!app.remoteName || !expose) return null;
	try {
		await loadRemoteEntryScript(remoteEntryUrl(app), app.remoteName);
		const container = (globalThis as Record<string, unknown>)[app.remoteName] as FederationContainer | undefined;
		if (!container?.get) return null;
		try {
			const shareScope = (globalThis as { __webpack_share_scopes__?: { default?: unknown } }).__webpack_share_scopes__?.default ?? {};
			await container.init(shareScope);
		} catch {
			// El contenedor ya estaba inicializado por el host: continuar.
		}
		const factory = await container.get(expose);
		const mod = factory() as { default?: T } | T;
		return ((mod as { default?: T })?.default ?? mod) as T;
	} catch {
		return null;
	}
}

/**
 * Carga bajo demanda el resolver federado de una app (su `remoteEntry.js`) y lo
 * cachea. Degrada a `null` (fallback por defecto) ante cualquier fallo —incluido
 * SSR, app sin resolver expuesto o error de red—.
 */
function loadRemoteResolver(app: PlatformApp): Promise<PlatformLinkResolver | null> {
	const registry = getRegistry();
	const cached = registry.resolvers.get(app.id);
	if (cached) return Promise.resolve(cached);
	const inFlight = registry.loading.get(app.id);
	if (inFlight) return inFlight;

	const promise = (async (): Promise<PlatformLinkResolver | null> => {
		if (!app.resolverExpose) return null;
		const resolver = await loadPlatformRemoteModule<PlatformLinkResolver>(app, app.resolverExpose);
		if (typeof resolver !== "function") return null;
		registry.resolvers.set(app.id, resolver);
		return resolver;
	})();

	registry.loading.set(app.id, promise);
	return promise;
}

/** Resolver activo de una app: el registrado manualmente o el federado lazy. */
function getResolver(app: PlatformApp): Promise<PlatformLinkResolver | null> {
	const registered = getRegistry().resolvers.get(app.id);
	if (registered) return Promise.resolve(registered);
	return loadRemoteResolver(app);
}

async function doResolve(ref: PlatformLinkRef): Promise<PlatformLinkInfo> {
	const base = buildBaseInfo(ref);
	const resolver = await getResolver(ref.app);
	if (!resolver) return base;
	try {
		const partial = await resolver(ref);
		if (!partial) return base;
		return {
			...base,
			...partial,
			// Nunca permitir que el resolver borre datos base por undefined.
			title: partial.title ?? base.title,
			appLabel: partial.appLabel ?? base.appLabel,
			iconTag: partial.iconTag ?? base.iconTag,
			href: partial.href ?? base.href,
			status: partial.status ?? "ok",
		};
	} catch {
		return { ...base, status: "error" };
	}
}

/**
 * Resuelve la información completa del chip para una URL. Devuelve `null` si la
 * URL no es un enlace de plataforma. Cachea por URL (incluida la promesa
 * in-flight) para no refetchear el mismo enlace repetido en un documento.
 */
export function resolvePlatformLinkInfo(rawUrl: string): Promise<PlatformLinkInfo | null> {
	const ref = resolvePlatformLink(rawUrl);
	if (!ref) return Promise.resolve(null);
	const registry = getRegistry();
	const cached = registry.cache.get(ref.url);
	if (cached) return cached;
	const promise = doResolve(ref);
	registry.cache.set(ref.url, promise);
	return promise;
}
