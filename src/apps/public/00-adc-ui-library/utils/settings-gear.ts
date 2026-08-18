import { useEffect, useRef } from "react";

type GearElement = HTMLElement & { enabled?: boolean; label?: string; expanded?: boolean };

/**
 * El engranaje lo pinta `adc-site-header`, que es un web component: cuando la app monta, Stencil
 * puede no haberlo definido todavía. Se reintenta unos frames en vez de asumir que está.
 */
function whenGearReady(use: (gear: GearElement) => void): () => void {
	let frame = 0;
	let cancelled = false;
	const tick = () => {
		if (cancelled) return;
		const gear = document.querySelector("adc-settings-menu") as GearElement | null;
		if (gear) return use(gear);
		if (frame++ < 60) requestAnimationFrame(tick);
	};
	tick();
	return () => {
		cancelled = true;
	};
}

/**
 * Enciende el engranaje de configuración del header y avisa cuando lo clickean.
 *
 * El botón vive en el header y el modal en el árbol de la app, así que la comunicación es
 * imperativa sobre el elemento: pasarle los paneles por un slot es justo lo que rompe con React
 * (Stencil reubica los nodos slotteados y el siguiente render falla con `insertBefore`).
 *
 * Al desmontarse lo apaga: navegar a una app sin preferencias no puede dejar un engranaje que
 * abre un modal que ya no existe.
 */
export function useHeaderSettingsGear(opts: { enabled: boolean; label: string; open: boolean; onToggle: () => void }): void {
	const { enabled, label, open, onToggle } = opts;

	// El handler cambia en cada render (closure sobre el estado): por la ref, la suscripción se
	// hace una sola vez en vez de desengancharse y volver a engancharse en cada pintada.
	const toggleRef = useRef(onToggle);
	toggleRef.current = onToggle;

	useEffect(() => {
		return whenGearReady((gear) => {
			gear.enabled = enabled;
			gear.label = label;
		});
	}, [enabled, label]);

	useEffect(() => whenGearReady((gear) => (gear.expanded = open)), [open]);

	useEffect(() => {
		let detach: (() => void) | undefined;
		const cancel = whenGearReady((gear) => {
			const handler = () => toggleRef.current();
			gear.addEventListener("adcSettingsToggle", handler);
			detach = () => {
				gear.removeEventListener("adcSettingsToggle", handler);
				gear.enabled = false;
			};
		});
		return () => {
			cancel();
			detach?.();
		};
	}, []);
}
