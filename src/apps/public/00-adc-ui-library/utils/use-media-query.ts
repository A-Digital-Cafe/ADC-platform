import { useEffect, useState } from "react";

/**
 * Ancho por debajo del breakpoint `lg` de Tailwind (1024px), el mismo corte que
 * usan `adc-sidebar` (drawer off-canvas) y `adc-page-shell` (offset del aside).
 * Mantener una única constante evita que el layout JS y las clases `lg:` se
 * desincronicen.
 */
export const COMPACT_QUERY = "(max-width: 1023.98px)";

/**
 * Hook React para media queries: devuelve si la query matchea y se re-renderiza
 * cuando cambia (rotar el teléfono, redimensionar la ventana).
 *
 * @example
 * const compact = useMediaQuery(COMPACT_QUERY);
 */
export function useMediaQuery(query: string): boolean {
	const [matches, setMatches] = useState(() => globalThis.matchMedia?.(query).matches ?? false);

	useEffect(() => {
		const mql = globalThis.matchMedia?.(query);
		if (!mql) return;
		setMatches(mql.matches);
		const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
		mql.addEventListener("change", onChange);
		return () => mql.removeEventListener("change", onChange);
	}, [query]);

	return matches;
}

/** Atajo para el corte compacto (mobile o ventana angosta). Ver {@link COMPACT_QUERY}. */
export function useIsCompact(): boolean {
	return useMediaQuery(COMPACT_QUERY);
}
