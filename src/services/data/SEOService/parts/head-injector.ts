import type { FastifyRequest, FastifyReply } from "fastify";
import type { ILogger } from "../../../../interfaces/utils/ILogger.js";
import type { CachedRender, HostSEOState, PageMeta } from "./types.js";
import { buildAbsoluteOrigin, payloadToString } from "./host-utils.js";
import { matchPath, mergeMeta } from "./matcher.js";
import { renderHeadTags } from "./head-render.js";

const RENDER_CACHE_MAX = 1024;
const HTML_PROCESS_MAX_BYTES = 512 * 1024;

interface HeadInjectorOptions {
	seoByHost: Map<string, HostSEOState>;
	renderCache: Map<string, CachedRender>;
	logger: ILogger;
}

/**
 * Encapsula el hook `onSend` que inyecta `<meta>`/JSON-LD antes de `</head>`
 * sobre respuestas HTML 2xx de hosts marcados como SEO-enabled.
 *
 * IMPORTANTE: el hook es 100% síncrono en el hot path. Fastify, al recibir un
 * onSend hook async, introduce un tick de microtask antes del `safeWriteHead`
 * final. Si el cliente cierra la conexión durante ese tick, Fastify intenta
 * writeHead sobre un socket destruido y emite `ERR_HTTP_HEADERS_SENT` como
 * `unhandledRejection`. Mantener el hook sync elimina ese tick y la race.
 *
 * Las `meta` registradas como `async` se resuelven en background (no bloquean
 * la respuesta) y se cachean. La primera petición no incluye esos tags
 * dinámicos; las siguientes sí.
 */
export class HeadInjector {
	readonly #seoByHost: Map<string, HostSEOState>;
	readonly #renderCache: Map<string, CachedRender>;
	readonly #logger: ILogger;
	readonly #pendingAsync = new Set<string>();

	constructor(opts: HeadInjectorOptions) {
		this.#seoByHost = opts.seoByHost;
		this.#renderCache = opts.renderCache;
		this.#logger = opts.logger;
	}

	onSend(request: FastifyRequest, reply: FastifyReply, payload: unknown): unknown {
		try {
			return this.#onSendImpl(request, reply, payload);
		} catch (e) {
			this.#logger.logWarn(`SEO onSend swallow: ${(e as Error)?.message ?? e}`);
			return payload;
		}
	}

	#onSendImpl(request: FastifyRequest, reply: FastifyReply, payload: unknown): unknown {
		if (this.#responseUnsafe(request, reply)) return payload;

		const status = reply.statusCode;
		if (status < 200 || status >= 300) return payload;
		const contentType = String(reply.getHeader("content-type") ?? "");
		if (!contentType.toLowerCase().startsWith("text/html")) return payload;

		const transferEncoding = String(reply.getHeader("transfer-encoding") ?? "").toLowerCase();
		if (transferEncoding && transferEncoding !== "identity") return payload;

		const rawHost = String(request.headers.host ?? "")
			.split(":")[0]
			?.toLowerCase();
		if (!rawHost) return payload;
		const state = this.#matchHost(rawHost);
		if (!state?.enabled) return payload;

		const html = payloadToString(payload);
		if (html == null || html.length > HTML_PROCESS_MAX_BYTES) return payload;
		const headCloseIdx = html.indexOf("</head>");
		if (headCloseIdx < 0) return payload;

		const urlPath = request.url.split("?")[0] || "/";
		const tags = this.#renderTagsSync(rawHost, urlPath, state, request);
		if (!tags) return payload;

		const out = html.slice(0, headCloseIdx) + tags + html.slice(headCloseIdx);
		try {
			reply.header("Content-Length", Buffer.byteLength(out));
		} catch {
			return payload;
		}
		return out;
	}

	/**
	 * Verifica si la respuesta ya no admite mutaciones (headers enviados, request abortada,
	 * socket destruido). Cualquier modificación posterior dispararía `ERR_HTTP_HEADERS_SENT`.
	 */
	#responseUnsafe(request: FastifyRequest, reply: FastifyReply): boolean {
		if (reply.sent) return true;
		const raw = reply.raw;
		if (raw?.headersSent || raw?.writableEnded || raw?.destroyed) return true;
		const reqRaw = request.raw;
		if (reqRaw?.aborted || reqRaw?.destroyed) return true;
		return false;
	}

	#matchHost(rawHost: string): HostSEOState | null {
		const direct = this.#seoByHost.get(rawHost);
		if (direct?.enabled) return direct;
		for (const [pattern, state] of this.#seoByHost) {
			if (!state.enabled) continue;
			if (pattern.startsWith("*.") && rawHost.endsWith(pattern.slice(1))) return state;
		}
		return null;
	}

	/**
	 * Versión síncrona: si la `meta` registrada es función async, no la await-ea.
	 * Dispara la resolución en background y cachea para próximas peticiones.
	 * La primera petición recibe `defaults` sin la meta dinámica.
	 */
	#renderTagsSync(host: string, urlPath: string, state: HostSEOState, request: FastifyRequest): string {
		const matched = matchPath(state, urlPath);
		if (!matched) return "";

		const cacheKey = `${host}:${urlPath}`;
		const cached = this.#renderCache.get(cacheKey);
		if (cached && cached.expires > Date.now()) return cached.tags;

		let meta: PageMeta | null;
		if (typeof matched.entry.meta === "function") {
			// Async path: dispara en background, sirve con defaults por ahora.
			this.#scheduleAsyncMeta(cacheKey, host, urlPath, state, matched.entry, request);
			meta = null;
		} else {
			meta = matched.entry.meta;
		}

		const merged = mergeMeta(state.defaults, meta);
		if (!merged) return "";

		const origin = buildAbsoluteOrigin(request, host);
		const tags = renderHeadTags(merged, origin, urlPath);

		// Solo cachea cuando la meta es estática (no podemos cachear "defaults"
		// como si fuera la respuesta final del meta async).
		if (typeof matched.entry.meta !== "function") {
			if (this.#renderCache.size >= RENDER_CACHE_MAX) {
				const oldest = this.#renderCache.keys().next().value;
				if (oldest) this.#renderCache.delete(oldest);
			}
			this.#renderCache.set(cacheKey, { tags, expires: Date.now() + matched.entry.cacheTtlMs });
		}
		return tags;
	}

	#scheduleAsyncMeta(
		cacheKey: string,
		host: string,
		urlPath: string,
		state: HostSEOState,
		entry: ReturnType<typeof matchPath> extends { entry: infer E } | null ? E : never,
		request: FastifyRequest
	): void {
		if (this.#pendingAsync.has(cacheKey)) return;
		this.#pendingAsync.add(cacheKey);
		const metaFn = entry.meta as (ctx: { host: string; path: string; params: Record<string, string> }) => Promise<PageMeta | null>;
		const params = matchPath(state, urlPath)?.params ?? {};
		// queueMicrotask para no bloquear la respuesta actual ni propagar errores.
		queueMicrotask(async () => {
			try {
				const meta = await metaFn({ host, path: urlPath, params });
				const merged = mergeMeta(state.defaults, meta);
				if (!merged) return;
				const origin = buildAbsoluteOrigin(request, host);
				const tags = renderHeadTags(merged, origin, urlPath);
				if (this.#renderCache.size >= RENDER_CACHE_MAX) {
					const oldest = this.#renderCache.keys().next().value;
					if (oldest) this.#renderCache.delete(oldest);
				}
				this.#renderCache.set(cacheKey, { tags, expires: Date.now() + entry.cacheTtlMs });
			} catch (e) {
				this.#logger.logWarn(`SEO async meta falló (${urlPath}): ${(e as Error).message}`);
			} finally {
				this.#pendingAsync.delete(cacheKey);
			}
		});
	}
}
