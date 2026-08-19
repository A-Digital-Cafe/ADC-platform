const CONTENT_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "application/javascript; charset=utf-8",
	".mjs": "application/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".txt": "text/plain; charset=utf-8",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".eot": "application/vnd.ms-fontobject",
	".map": "application/json",
	".webmanifest": "application/manifest+json",
	".webp": "image/webp",
	".avif": "image/avif",
};

/** MIME de una extensión (con punto y en minúsculas), o binario genérico. */
export function contentTypeFor(ext: string): string {
	return CONTENT_TYPES[ext] || "application/octet-stream";
}
