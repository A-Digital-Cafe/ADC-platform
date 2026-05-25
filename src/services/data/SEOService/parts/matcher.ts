import type { CompiledEntry, HostSEOState, PageMeta, PageMetaEntry } from "./types.js";

const DEFAULT_TTL = 300_000;

export function compileEntry(page: PageMetaEntry): CompiledEntry {
	const normalized = page.path.startsWith("/") ? page.path : `/${page.path}`;
	const hasParam = /[:*]/.test(normalized);
	const paramNames: string[] = [];
	const regexSrc = normalized
		.replaceAll(/:([^/]+)/g, (_m, name: string) => {
			paramNames.push(name);
			return "([^/]+)";
		})
		.replaceAll("*", ".*");
	return {
		exact: !hasParam,
		path: normalized,
		regex: new RegExp(`^${regexSrc}$`),
		paramNames,
		meta: page.meta,
		cacheTtlMs: page.cacheTtlMs ?? DEFAULT_TTL,
	};
}

export function matchPath(state: HostSEOState, urlPath: string): { entry: CompiledEntry; params: Record<string, string> } | null {
	const exact = state.exact.get(urlPath);
	if (exact) return { entry: exact, params: {} };
	for (const entry of state.patterns) {
		const m = entry.regex.exec(urlPath);
		if (!m) continue;
		const params: Record<string, string> = {};
		entry.paramNames.forEach((name, i) => {
			params[name] = m[i + 1];
		});
		return { entry, params };
	}
	return null;
}

export function mergeDefaults(target: PageMeta, src: PageMeta): void {
	Object.assign(target, src);
	if (src.og) target.og = { ...target.og, ...src.og };
	if (src.twitter) target.twitter = { ...target.twitter, ...src.twitter };
}

export function mergeMeta(defaults: PageMeta, override: PageMeta | null): PageMeta | null {
	if (!override) return Object.keys(defaults).length ? defaults : null;
	const out: PageMeta = { ...defaults, ...override };
	if (defaults.og || override.og) out.og = { ...defaults.og, ...override.og };
	if (defaults.twitter || override.twitter) out.twitter = { ...defaults.twitter, ...override.twitter };
	if (defaults.article || override.article) out.article = { ...defaults.article, ...override.article };
	return out;
}
