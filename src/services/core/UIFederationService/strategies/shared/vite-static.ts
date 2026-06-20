import * as fs from "node:fs";
import * as path from "node:path";
import { getCommonPublicDir } from "../../utils/fs/path-resolver.js";
import type { IBuildContext } from "../types.js";

/** Mapa consolidado de extensiones a content-types para servir archivos estáticos */
const STATIC_CONTENT_TYPES: Record<string, string> = {
	".webp": "image/webp",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".css": "text/css",
	".js": "application/javascript",
	".json": "application/json",
	".txt": "text/plain; charset=utf-8",
	".webmanifest": "application/manifest+json",
};

/**
 * Sirve un archivo estático con el content-type apropiado.
 * @returns true si el archivo fue servido, false si no existe.
 */
function serveStaticFile(filePath: string, res: any, maxAge: number): boolean {
	if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
		const ext = path.extname(filePath).toLowerCase();
		const contentType = STATIC_CONTENT_TYPES[ext] || "application/octet-stream";
		res.setHeader("Content-Type", contentType);
		res.setHeader("Cache-Control", `public, max-age=${maxAge}`);
		fs.createReadStream(filePath).pipe(res);
		return true;
	}
	return false;
}

/**
 * Plugin que sirve assets estáticos de uiDependencies (UI libraries Stencil) bajo `/ui/`.
 */
export function createStaticAssetsPlugin(context: IBuildContext): any {
	const { module, registeredModules } = context;
	const uiDependencies = module.uiConfig.uiDependencies || [];

	const uiLibraryDirs: string[] = [];
	for (const depName of uiDependencies) {
		const depModule = registeredModules.get(depName);
		if (depModule?.uiConfig.framework === "stencil") {
			const publicDir = path.join(depModule.appDir, "public");
			if (fs.existsSync(publicDir)) {
				uiLibraryDirs.push(publicDir);
			}
		}
	}

	if (uiLibraryDirs.length === 0) return null;

	return {
		name: "serve-ui-library-assets",
		configureServer(server: any) {
			server.middlewares.use((req: any, res: any, next: any) => {
				if (!req.url?.startsWith("/ui/")) return next();

				const relativePath = req.url.slice(4);
				for (const dir of uiLibraryDirs) {
					const filePath = path.join(dir, relativePath);
					if (serveStaticFile(filePath, res, 31536000)) return;
				}
				next();
			});
		},
	};
}

/**
 * Plugin que sirve `common/public/` como fallback (ej: favicon por defecto).
 */
export function createCommonPublicFallbackPlugin(): any {
	const commonDir = getCommonPublicDir();
	if (!fs.existsSync(commonDir)) return null;

	return {
		name: "serve-common-public-fallback",
		configureServer(server: any) {
			server.middlewares.use((req: any, res: any, next: any) => {
				if (!req.url || req.url.startsWith("/ui/") || req.url.startsWith("/@")) return next();

				const cleanUrl = req.url.split("?")[0].split("#")[0];
				const filePath = path.join(commonDir, cleanUrl);
				if (serveStaticFile(filePath, res, 86400)) return;
				next();
			});
		},
	};
}
