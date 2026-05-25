import { stat } from "node:fs/promises";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { ILogger } from "../../../../interfaces/utils/ILogger.js";
import type { SitemapEntry, SitemapRegistration } from "./types.js";
import { buildAbsoluteOrigin } from "./host-utils.js";
import { renderSitemapXml, renderSitemapIndexXml, type SitemapIndexEntry } from "./sitemap-render.js";

const mtimeCache = new Map<string, { value: Date; expires: number }>();
const MTIME_TTL_MS = 60_000;

async function getDirMtime(dir: string): Promise<Date | undefined> {
	const cached = mtimeCache.get(dir);
	const now = Date.now();
	if (cached && cached.expires > now) return cached.value;
	try {
		const s = await stat(dir);
		mtimeCache.set(dir, { value: s.mtime, expires: now + MTIME_TTL_MS });
		return s.mtime;
	} catch {
		return undefined;
	}
}

/**
 * Construye y sirve el sitemap.xml (urlset) para un host: itera registros,
 * dedupea por `path` y aplica `lastmod` por defecto desde el `mtime` del
 * directorio de cada módulo cuando la entrada no declare uno propio.
 */
export async function serveSitemap(
	hostPattern: string,
	regs: SitemapRegistration[],
	req: FastifyRequest,
	reply: FastifyReply,
	logger: ILogger
): Promise<void> {
	const baseUrl = buildAbsoluteOrigin(req, hostPattern);

	const seen = new Set<string>();
	const entries: SitemapEntry[] = [];
	for (const r of regs) {
		const defaultLastmod = r.appDir ? await getDirMtime(r.appDir) : undefined;
		try {
			const raw = typeof r.source === "function" ? await r.source() : r.source;
			for (const item of raw) {
				const entry: SitemapEntry = typeof item === "string" ? { path: item } : { ...item };
				if (!entry.path || seen.has(entry.path)) continue;
				seen.add(entry.path);
				if (!entry.lastmod && defaultLastmod) entry.lastmod = defaultLastmod;
				entries.push(entry);
			}
		} catch (e) {
			logger.logWarn(`Error obteniendo paths de ${r.appName}: ${(e as Error).message}`);
		}
	}

	reply.header("Content-Type", "application/xml; charset=utf-8");
	reply.header("Cache-Control", "public, max-age=300");
	reply.send(renderSitemapXml(baseUrl, entries));
}

/**
 * Sirve un `<sitemapindex>` para un host índice. Enlaza `/sitemaps/main.xml`
 * del propio host y `/sitemap.xml` de los hosts hermanos (mismo dominio base,
 * excluyendo wildcards y el propio host índice).
 */
export async function serveSitemapIndex(
	hostPattern: string,
	regs: SitemapRegistration[],
	siblingHosts: string[],
	req: FastifyRequest,
	reply: FastifyReply
): Promise<void> {
	const proto = (() => {
		const f = req.headers["x-forwarded-proto"];
		return (typeof f === "string" ? f.split(",")[0].trim() : "") || "https";
	})();
	const baseUrl = buildAbsoluteOrigin(req, hostPattern);

	// `lastmod` del índice = mtime más reciente entre los módulos del host índice.
	let indexLastmod: Date | undefined;
	for (const r of regs) {
		if (!r.appDir) continue;
		const m = await getDirMtime(r.appDir);
		if (m && (!indexLastmod || m.getTime() > indexLastmod.getTime())) indexLastmod = m;
	}

	const entries: SitemapIndexEntry[] = [{ loc: `${baseUrl}/sitemaps/main.xml`, lastmod: indexLastmod }];
	for (const host of siblingHosts) {
		entries.push({ loc: `${proto}://${host}/sitemap.xml` });
	}

	reply.header("Content-Type", "application/xml; charset=utf-8");
	reply.header("Cache-Control", "public, max-age=300");
	reply.send(renderSitemapIndexXml(entries));
}
