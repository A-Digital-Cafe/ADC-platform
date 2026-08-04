/**
 * Caja contra la que un descendiente `position: fixed` resuelve sus coordenadas.
 *
 * `fixed` se ancla al viewport **salvo** que algún ancestro cree un bloque contenedor:
 * `transform`, `filter`, `backdrop-filter`, `perspective`, un `will-change` de cualquiera de
 * esos, o `contain`. Cuando pasa, las coordenadas de viewport que devuelve
 * `getBoundingClientRect()` se interpretan contra ese ancestro y el panel aparece corrido por
 * su origen (caso real: `adc-section-panel` usa `backdrop-filter: blur()`, y el menú de
 * `adc-select` saltaba ~475 px fuera de pantalla dentro de él).
 *
 * Devuelve el viewport cuando no hay tal ancestro, con lo que restar esta caja deja el cálculo
 * idéntico al de anclar contra el viewport: los llamadores no necesitan un camino aparte.
 *
 * Compensa por desplazamiento, que es exacto para el caso habitual (sin transform, o con una
 * traslación). Un ancestro escalado o rotado necesitaría deshacer la matriz entera.
 */
export interface FixedAnchor {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

function createsContainingBlock(style: CSSStyleDeclaration): boolean {
	return (
		style.transform !== "none" ||
		style.filter !== "none" ||
		style.perspective !== "none" ||
		(style.getPropertyValue("backdrop-filter") || style.getPropertyValue("-webkit-backdrop-filter") || "none") !== "none" ||
		/transform|filter|perspective/.test(style.willChange) ||
		/paint|layout|strict|content/.test(style.contain)
	);
}

/** @param from Elemento desde el que subir; normalmente el disparador o el propio host. */
export function fixedAnchor(from: Element | null | undefined): FixedAnchor {
	for (let node = from?.parentElement; node; node = node.parentElement) {
		const style = getComputedStyle(node);
		if (!createsContainingBlock(style)) continue;
		// El bloque contenedor es el *padding box* del ancestro: hay que descontarle el borde.
		const rect = node.getBoundingClientRect();
		return {
			left: rect.left + (Number.parseFloat(style.borderLeftWidth) || 0),
			top: rect.top + (Number.parseFloat(style.borderTopWidth) || 0),
			right: rect.right - (Number.parseFloat(style.borderRightWidth) || 0),
			bottom: rect.bottom - (Number.parseFloat(style.borderBottomWidth) || 0),
		};
	}
	return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
}
