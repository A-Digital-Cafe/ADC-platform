import type { PathMatchResult } from "../types.js";

/**
 * Calcula la especificidad de un patrón de ruta. Más estática = mayor.
 * Garantiza que `/x/draft` se evalúe antes que `/x/:id` durante el matching.
 */
export function routeSpecificity(pattern: string): number {
	const segments = pattern.split("/").filter(Boolean);
	let score = 0;
	for (const seg of segments) {
		if (seg.startsWith(":")) score += 1;
		else if (seg.includes("*")) score += 0;
		else score += 100;
	}
	// Desempate menor: rutas más largas son ligeramente preferidas.
	return score * 1000 + segments.length;
}

/** Matchea `urlPath` contra un patrón con `:param` y `*`, extrayendo los parámetros. */
export function matchPath(pattern: string, urlPath: string): PathMatchResult {
	// Extraer nombres de parámetros del patrón
	const paramNames: string[] = [];
	const regexPattern = pattern
		.replaceAll(/:([^/]+)/g, (_match, paramName) => {
			paramNames.push(paramName);
			return "([^/]+)";
		})
		.replaceAll("*", ".*");

	const regex = new RegExp(`^${regexPattern}$`);
	const match = regex.exec(urlPath);

	if (!match) {
		return { matched: false, params: {} };
	}

	// Extraer valores de parámetros
	const params: Record<string, string> = {};
	paramNames.forEach((name, index) => {
		params[name] = match[index + 1];
	});

	return { matched: true, params };
}
