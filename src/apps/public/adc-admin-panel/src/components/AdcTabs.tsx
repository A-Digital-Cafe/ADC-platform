import { useEffect, useRef } from "react";

export interface AdcTab {
	id: string;
	label: string;
}

/**
 * Envoltorio de `adc-tabs` (UI library) con el patrón ref + addEventListener que usan
 * las demás apps (adc-identity, adc-project-manager): emite `adcTabChange` con el id.
 */
export function AdcTabs({
	tabs,
	activeId,
	onChange,
}: {
	readonly tabs: AdcTab[];
	readonly activeId: string;
	/** El id llega como string crudo del custom element: el union de tabs es de cada caller, que lo estrecha. */
	readonly onChange: (id: string) => void;
}) {
	const ref = useRef<HTMLElement>(null);
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const handler = (e: Event) => onChange((e as CustomEvent<string>).detail);
		el.addEventListener("adcTabChange", handler);
		return () => el.removeEventListener("adcTabChange", handler);
	}, [onChange]);
	return <adc-tabs ref={ref} tabs={JSON.stringify(tabs)} activeTab={activeId} variant="underline" />;
}
