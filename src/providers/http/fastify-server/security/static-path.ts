import * as path from "node:path";
import { isInsideBase } from "@common/utils/path-containment.ts";

function decodeRequestPath(requestPath: string): string | null {
	try {
		return decodeURIComponent(requestPath);
	} catch {
		return null;
	}
}

/**
 * Path de la URL tal como lo va a ver la resolución de archivos: decodificado y normalizado
 * (`//`, `/./`, `/a/../`). **Todo chequeo por ruta tiene que usar esto**, no `request.url`.
 *
 * Comparar la URL cruda mientras el archivo se resuelve decodificando es una familia entera de
 * bypasses: `//expose_X.js` no empieza con `/expose_X.` pero resuelve al mismo archivo, y
 * `loader.js%2Emap` no termina en `.map` pero abre el mapa igual.
 *
 * `null` si el path no es decodificable o trae NUL: quien lo reciba debe rechazar la request.
 */
export function normalizeUrlPath(requestPath: string): string | null {
	if (requestPath.includes("\0")) return null;
	const decoded = decodeRequestPath(requestPath);
	if (decoded === null || decoded.includes("\0")) return null;
	const normalized = path.posix.normalize(decoded.replaceAll("\\", "/"));
	return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

export function resolveSafeStaticPath(baseDir: string, requestPath: string): string | null {
	if (!baseDir || requestPath.includes("\0")) return null;

	const decodedPath = decodeRequestPath(requestPath);
	if (!decodedPath || decodedPath.includes("\0")) return null;

	const normalizedPath = decodedPath.startsWith("/") ? `.${decodedPath}` : decodedPath;
	const resolvedPath = path.resolve(baseDir, normalizedPath);
	return isInsideBase(baseDir, resolvedPath) ? resolvedPath : null;
}

export function isSafeStaticPath(baseDir: string, filePath: string): boolean {
	return Boolean(baseDir) && isInsideBase(baseDir, filePath);
}

/**
 * Rutas de build que NO se sirven fuera de desarrollo, estén o no en disco.
 *
 * Es el cinturón del tirante: `stencil-config` ya no genera source maps en producción y el
 * post-build poda `collection/`, `cjs/` y `types/`, pero eso depende de que cada build esté bien
 * configurado. Esto no: una library nueva, un árbol viejo o una variable puesta a mano no pueden
 * volver a publicar el TypeScript original. Lo que un mapa expone es `sourcesContent`, o sea el
 * fuente entero — incluido el `src/common` que la library arrastra.
 *
 * `ADC_SERVE_SOURCEMAPS=true` lo levanta para depurar un incidente en producción; es deliberado
 * y temporal, y no afecta a desarrollo (ahí nunca se bloquea).
 *
 * Mira `NODE_ENV` crudo y no `isRealProduction()` a propósito: `start:prodtests` corre con
 * seguridad degradada pero tiene que **publicar lo mismo** que producción, o el ensayo no sirve
 * para detectar que algo se está filtrando.
 */
const BLOCKED_BUILD_SEGMENTS = ["/collection/", "/cjs/", "/types/", "/custom-elements/"];
/**
 * Los directorios se bloquean sólo cuando la URL además pide un archivo de código. Sin esto,
 * una ruta de SPA como `/types/tarifas` daría 404 en vez de cargar la app: los hosts UI llevan
 * `spaFallback`, así que cualquier ruta del cliente pasa por acá.
 */
const CODE_EXTENSIONS = /\.(?:js|mjs|cjs|ts|tsx|d\.ts|json|map)$/i;

export function isBlockedBuildArtifact(urlPath: string): boolean {
	if (process.env.NODE_ENV === "development" || process.env.ADC_SERVE_SOURCEMAPS === "true") return false;
	// Sobre el path normalizado, no el crudo: `loader.js%2Emap` no termina en `.map` pero abre
	// el mapa igual, y `/x/collection%2Fa.js` no contiene `/collection/`.
	const normalized = normalizeUrlPath(urlPath);
	if (normalized === null) return true; // path indecodificable: no se sirve nada
	// Ningún archivo servible legítimo ni ruta de SPA termina en `.map`.
	if (normalized.endsWith(".map")) return true;
	if (!CODE_EXTENSIONS.test(normalized)) return false;
	return BLOCKED_BUILD_SEGMENTS.some((segment) => normalized.includes(segment));
}

/**
 * Extensiones que sólo puede pedir un asset, nunca una ruta del router del cliente. Es una lista
 * cerrada y no `path.extname()` porque hay slugs con punto —`/articles/node.js-basics` da
 * extensión `.js-basics`— y ésos tienen que seguir cayendo en el `spaFallback`.
 */
const STATIC_ASSET_EXTENSIONS = new Set([
	"js", "mjs", "cjs", "css", "map", "json", "webmanifest", "xml", "txt",
	"ico", "png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "bmp",
	"woff", "woff2", "ttf", "otf", "eot",
	"mp3", "mp4", "webm", "ogg", "wav",
	"pdf", "zip", "wasm", "html", "htm",
]);

/**
 * ¿La URL pide un archivo concreto? Lo usa el `spaFallback` para no contestar el `index.html`
 * cuando el archivo no está: un `.js` que devuelve HTML con 200 es un error mudo —el `<script>`
 * falla por MIME, el import map parece resolver, y los buscadores indexan el shell bajo la URL
 * del asset—. Ahí corresponde 404.
 */
export function looksLikeStaticAsset(filePath: string): boolean {
	const name = filePath.replaceAll("\\", "/").split("/").pop() ?? "";
	const dot = name.lastIndexOf(".");
	return dot > 0 && STATIC_ASSET_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

/**
 * ¿El nombre del archivo lleva un hash de contenido? (`main.a1b2c3d4.js`, `p-048bb303.entry.js`,
 * `index-CXFLINVP.js`). Sólo esos pueden servirse `immutable`: su URL cambia con el contenido.
 *
 * Reconoce las tres formas que produce el árbol: el `[contenthash:8]` hexadecimal de rspack, el
 * `p-<hash>` de los chunks lazy de Stencil y el hash base64url de los módulos de rollup/Stencil.
 * Ante la duda NO matchea: un falso positivo dejaría un archivo mutable cacheado un año.
 */
const CONTENT_HASHED = [
	/\.[0-9a-f]{8,}\.[a-z0-9]+$/i, // main.a1b2c3d4.js  (rspack [contenthash])
	/^p-[0-9a-z]{8,}[.-]/i, // p-048bb303.entry.js  (chunks lazy de Stencil)
	/-[A-Za-z0-9]{8}\.[a-z0-9]+$/, // index-CXFLINVP.js  (rollup/Stencil)
];

/**
 * El último segmento tiene que parecer un hash, no una palabra. `index-CXFLINVP.js` sí;
 * `algo-fallback.js` no, aunque las dos tengan ocho caracteres antes de la extensión. Sin este
 * filtro, cualquier archivo terminado en `-<ocholetras>.js` quedaba cacheado un año siendo mutable
 * —que es el error caro: el archivo con hash cacheado de menos sólo cuesta una revalidación.
 */
function looksLikeHash(name: string): boolean {
	const segment = /-([A-Za-z0-9]{8})\.[a-z0-9]+$/.exec(name)?.[1];
	if (!segment) return true; // el patrón que matcheó no es el de rollup
	return /[A-Z]/.test(segment) || /\d/.test(segment);
}

function hasContentHash(filePath: string): boolean {
	const normalized = filePath.replaceAll("\\", "/");
	const name = normalized.split("/").pop() ?? "";
	// El patrón de rollup es el único ambiguo (un nombre con guiones puede parecerse a un hash),
	// así que sólo cuenta dentro de `esm/`, que es donde Stencil emite esos nombres. Un falso
	// negativo cuesta una revalidación; un falso positivo, un archivo mutable cacheado un año.
	if (!normalized.includes("/esm/") && !CONTENT_HASHED[0].test(name) && !CONTENT_HASHED[1].test(name)) return false;
	return CONTENT_HASHED.some((pattern) => pattern.test(name)) && looksLikeHash(name);
}

/**
 * Código y manifiestos de nombre FIJO: son los que apuntan a los archivos hasheados.
 * `remoteEntry.js` (el manifiesto de Module Federation), el `init.js` y el `loader/index.js` de
 * las UI libraries, los import maps. Su contenido cambia en cada despliegue bajo la MISMA URL.
 */
const MUTABLE_ENTRYPOINT = /\.(?:html?|js|mjs|cjs|css|json|webmanifest)$/i;

/**
 * Política de caché de un estático. La regla de fondo es una sola: **lo que puede nombrar a otro
 * archivo tiene que revalidar; lo que es una hoja puede cachearse**.
 *
 * - Nombre con hash de contenido → un año, `immutable`. Es lo que permite desplegar sin purgar
 *   ninguna caché: la versión nueva viene con otra URL y la vieja puede quedar cacheada para
 *   siempre sin hacer daño.
 * - Código o manifiesto de nombre fijo → `no-cache` (se cachea, pero revalida siempre). Servir
 *   uno viejo es peor que no cachearlo: apunta a chunks hasheados que ya no existen y rompe la
 *   app entera —o, con Module Federation, deja de cargar el remoto—. Revalidar cuesta un 304.
 * - El resto (imágenes, fuentes, íconos) → una hora con revalidación en segundo plano: son hojas,
 *   no nombran a nadie, y una versión vieja un rato no rompe nada.
 */
export function staticCacheControl(filePath: string): string {
	if (hasContentHash(filePath)) return "public, max-age=31536000, immutable";
	if (MUTABLE_ENTRYPOINT.test(filePath)) return "no-cache";
	return "public, max-age=3600, stale-while-revalidate=86400";
}
