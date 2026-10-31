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

/**
 * Matchea `urlPath` contra un patrón con `:param` y `*`, extrayendo los parámetros. El comodín se
 * captura como `params["*"]` (convención de Fastify): sin él, un handler montado en `/x/*` no tiene
 * cómo saber qué path le tocó, porque el contexto del endpoint no lleva la URL cruda.
 */
export function matchPath(pattern: string, urlPath: string): PathMatchResult {
	const paramNames: string[] = [];
	const regexPattern = pattern.replaceAll(/:([^/]+)|\*/g, (token, paramName?: string) => {
		if (token === "*") {
			paramNames.push("*");
			return "(.*)";
		}
		paramNames.push(paramName ?? "");
		return "([^/]+)";
	});

	const regex = new RegExp(`^${regexPattern}$`);
	const match = regex.exec(urlPath);

	if (!match) {
		return { matched: false, params: {} };
	}

	const params: Record<string, string> = {};
	paramNames.forEach((name, index) => {
		// Con más de un `*` gana el primero, igual que antes no había ninguno: no es una forma soportada.
		if (name === "*" && params["*"] !== undefined) return;
		params[name] = match[index + 1];
	});

	return { matched: true, params };
}
