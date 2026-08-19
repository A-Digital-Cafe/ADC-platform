import * as fs from "node:fs";
import * as path from "node:path";
import { normalizeForConfig, getServerHost } from "../../utils/fs/path-resolver.js";
import type { IBuildContext } from "../types.js";
import { buildExposesConfig } from "./rspack-helpers.js";
import { BUNDLER_CACHE_CONTRACT, bundlerCacheDir } from "@common/utils/bundler-cache.ts";
import { sharedBundleInputs } from "@common/utils/build-id.ts";
import { ERROR_APP_DEVPORT } from "@common/utils/error-app.ts";

/** Versión de `@rspack/core` en uso: una caché escrita por otra versión no se reutiliza. */
let cachedRspackVersion: string | null = null;
function rspackVersion(): string {
	if (cachedRspackVersion) return cachedRspackVersion;
	try {
		const pkg = fs.readFileSync(path.resolve(process.cwd(), "node_modules", "@rspack", "core", "package.json"), "utf8");
		cachedRspackVersion = String(JSON.parse(pkg).version ?? "unknown");
	} catch {
		cachedRspackVersion = "unknown";
	}
	return cachedRspackVersion;
}

/**
 * Archivos cuyo hash invalida la caché. Es la mitad importante del diseño: lo que rspack
 * **no** ve como módulo (configs generadas, lockfile, manifiestos) tiene que estar acá o
 * la caché sobrevive a cambios que sí cambian el resultado.
 *
 * La config generada cubre por transitividad a los generadores: cualquier cambio en el
 * template, los aliases o la lista de módulos registrados termina en su contenido. Y como
 * rspack invalida por **hash** y no por mtime, regenerarla idéntica en cada boot no
 * invalida nada.
 *
 * Los que valen para cualquier módulo salen de `sharedBundleInputs()` y no de una lista de
 * acá: son los mismos que componen el `build-id` del nodo, y dos listas que deberían ser una
 * terminan divergiendo justo en el archivo que importaba.
 */
function cacheBuildDependencies(context: IBuildContext, configPath: string, extraConfigs: string[]): string[] {
	const { module } = context;
	const candidates = [
		configPath,
		...extraConfigs,
		path.join(module.appDir, "package.json"),
		path.join(module.appDir, "config.json"),
		path.join(module.appDir, "default.json"),
		...sharedBundleInputs(),
	];
	// `fs.existsSync` acá y no en el build: un `buildDependencies` con un path inexistente
	// hace que rspack descarte la caché en cada corrida (queda siempre "inválida").
	return [...new Set(candidates)].filter((file) => fs.existsSync(file));
}

/**
 * Bloque `cache` de rspack 2 (top-level; en rspack 1.x vivía en `experiments.cache`).
 *
 * Se apaga con `ADC_RSPACK_CACHE=false`. El aislamiento es por `version` + directorio:
 * contrato de caché, versión de rspack y modo van en la clave, así que un upgrade de
 * rspack o un cambio de dev↔prod nunca reutilizan artefactos de la combinación anterior.
 */
export function buildCacheBlock(context: IBuildContext, mode: string, configPath: string, extraConfigs: string[]): string {
	if (process.env.ADC_RSPACK_CACHE === "false") return "";
	const { module, namespace } = context;
	const directory = bundlerCacheDir(namespace, module.uiConfig.name);
	const version = `${BUNDLER_CACHE_CONTRACT}|rspack-${rspackVersion()}|${mode}`;
	const deps = cacheBuildDependencies(context, configPath, extraConfigs).map((file) => `'${normalizeForConfig(file)}'`);

	return `
    cache: {
        type: 'persistent',
        version: '${version}',
        buildDependencies: [
            ${deps.join(",\n            ")}
        ],
        storage: {
            type: 'filesystem',
            directory: '${normalizeForConfig(directory)}',
        },
    },`;
}

/** Inserta el alias de Tailwind v4 si está habilitado. */
export function injectTailwindAlias(aliasesObject: string, tailwindCssPath: string, appDir: string): string {
	if (!tailwindCssPath) return aliasesObject;

	const originalTailwindCss = normalizeForConfig(path.join(appDir, "src", "styles", "tailwind.css"));
	const generatedTailwindCss = normalizeForConfig(tailwindCssPath);

	if (aliasesObject === "{}") {
		return `{\n            '${originalTailwindCss}': '${generatedTailwindCss}'\n        }`;
	}

	return aliasesObject.replace(/\n {8}\}$/, `,\n            '${originalTailwindCss}': '${generatedTailwindCss}'\n        }`);
}

/** Decide el bloque federation para ModuleFederationPlugin (remotes / exposes / vacío). */
export function resolveFederationConfig(
	isLayout: boolean,
	isRemote: boolean,
	remotes: Record<string, string>,
	context: IBuildContext,
	appExtension: string
): string {
	const federationExposes = context.module.uiConfig.federationExposes;
	const hasExposes = !!federationExposes && Object.keys(federationExposes).length > 0;
	if (isLayout) return `remotes: ${JSON.stringify(remotes, null, 4)},`;
	// Un host también puede exponer remotes si declara `federationExposes`
	// (ej: resolvers de enlaces de plataforma consumidos por otras apps).
	if (isRemote || hasExposes) return buildExposesConfig(context, appExtension);
	return "";
}

/** Decide el `publicPath` correcto según rol del módulo y entorno. */
export function resolvePublicPath(opts: {
	isRemote: boolean;
	isHost: boolean;
	isProduction: boolean;
	devPort: number | undefined;
	hasExposes?: boolean;
}): string {
	const { isRemote, isHost, isProduction, devPort, hasExposes } = opts;
	// Un módulo que expone remotes (sea `isRemote` o un host con `federationExposes`)
	// debe servir sus chunks desde su propio origen para que otras apps los consuman.
	const servesRemote = isRemote || !!hasExposes;
	// Un host (tiene su propio index.html y se abre directo) que además expone debe
	// usar 'auto': resuelve sus chunks según el origen desde el que se cargue
	// (localhost vs IP de LAN), evitando el error cross-origin "Script error." al
	// inyectar `remoteEntry.js` con un host distinto al de la página.
	if (servesRemote && isHost) return "'auto'";
	if (servesRemote && devPort && !isProduction) {
		return `'http://${getServerHost()}:${devPort}/'`;
	}
	if (servesRemote) return "'auto'";
	if (isHost) return "'/'";
	return "'auto'";
}

/**
 * Gate de `uiModule.access` para el dev server.
 *
 * En desarrollo el kernel NO sirve estas apps —cada una corre en su propio puerto rspack—, así
 * que el gate del provider HTTP no las toca y el panel quedaría abierto justo donde más se
 * prueba. La verificación la sigue haciendo el kernel (`GET /api/auth/session` con la cookie
 * del visitante, que es del mismo host y por eso viaja); acá sólo se compara `user.roles`.
 *
 * Cachea 10s por cookie para no pedir una sesión por asset. Fail-closed: si el kernel no
 * contesta, no se sirve.
 */
export function buildDevAccessGate(moduleName: string, requiredRoles: readonly string[], globalOnly: boolean, requireAuth = false): string {
	// `requireAuth` o `globalOnly` sin roles también son un gate: sin esto, un módulo que sólo
	// pide sesión quedaba abierto en desarrollo mientras el kernel sí lo cierra en producción.
	if (requiredRoles.length === 0 && !requireAuth && !globalOnly) return "";
	return `
        setupMiddlewares: (middlewares) => {
            const REQUIRED = new Set(${JSON.stringify(requiredRoles)});
            const GLOBAL_ONLY = ${globalOnly};
            const cache = new Map();
            const decide = async (cookie) => {
                const hit = cache.get(cookie);
                if (hit && hit.until > Date.now()) return hit.reason;
                let reason = 'unavailable';
                try {
                    const res = await fetch('http://localhost:3000/api/auth/session', { headers: cookie ? { cookie } : {} });
                    if (res.status === 401) reason = 'auth';
                    else if (res.ok) {
                        const body = await res.json();
                        if (!body?.authenticated) reason = 'auth';
                        else if (GLOBAL_ONLY && body.user?.orgId) reason = 'org';
                        else if (REQUIRED.size === 0) reason = null;
                        else reason = (body.user?.roles ?? []).some((r) => REQUIRED.has(String(r).trim().toLowerCase())) ? null : 'role';
                    }
                } catch { /* kernel caído: queda 'unavailable' y no se sirve */ }
                cache.set(cookie, { reason, until: Date.now() + 10_000 });
                return reason;
            };
            middlewares.unshift({
                name: 'adc-access-gate',
                middleware: async (req, res, next) => {
                    // El canal de HMR no lleva cookie ni sirve contenido: gatearlo sólo rompe el reload.
                    if (req.url.startsWith('/ws') || req.url.includes('hot-update')) return next();
                    const reason = await decide(req.headers.cookie || '');
                    if (!reason) return next();
                    const host = (req.headers.host || 'localhost').split(':')[0];
                    const from = encodeURIComponent('http://' + (req.headers.host || '') + req.url);
                    res.statusCode = 302;
                    res.setHeader('Cache-Control', 'no-store');
                    res.setHeader('Location', \`http://\${host}:${ERROR_APP_DEVPORT}/unauthorized?app=${moduleName}&reason=\${reason}&from=\${from}\`);
                    res.end();
                },
            });
            return middlewares;
        },`;
}

/** Construye el bloque `devServer` (con proxy a i18n/sw del kernel). */
export function buildDevServerBlock(
	devPort: number | undefined,
	hotReload: boolean,
	staticDirs: string,
	namespace: string,
	accessGate = ""
): string {
	return `
    devServer: {
        host: '0.0.0.0',
        port: ${devPort},
        hot: ${hotReload},
        historyApiFallback: true,
        allowedHosts: 'all',
        static: ${staticDirs},
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
            'Access-Control-Allow-Headers': 'X-Requested-With, content-type, Authorization',
        },
        proxy: [
            {
                context: ['/${namespace}/adc-sw.js', '/${namespace}/adc-i18n.js', '/api/i18n'],
                target: 'http://localhost:3000',
                changeOrigin: true,
            },
        ],${accessGate}
    },`;
}
