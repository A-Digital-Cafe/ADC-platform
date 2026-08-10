import type { FeatureValue, PlanFeatureValue, PlanPrice, PlanSubjectType } from "../../utils/plans-api.ts";

/** Sujetos de una excepción, con su etiqueta para los selects. */
export const SUBJECT_TYPES: { value: PlanSubjectType; label: string }[] = [
	{ value: "user", label: "Usuario" },
	{ value: "org", label: "Organización" },
	{ value: "role", label: "Rol" },
	{ value: "org-members-default", label: "Default de miembros" },
];

/** Texto editable de un valor de plan; los escalables por asiento se muestran como JSON. */
/** @public */
export function valueToText(value: PlanFeatureValue): string {
	return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/**
 * Interpreta lo tipeado por el usuario: primero se prueba JSON (números, booleanos y
 * `{ base, perSeat }`) y lo que no es JSON válido queda como string, que es justo lo que
 * necesita una feature `enum` (`basic`, `full`). `undefined` = inválido.
 *
 * No se usa `isScaledValue` de `@common`: ese guard asume datos ya validados y acá el
 * objeto viene de un input, así que hay que verificar que `base` sea numérico.
 */
/** @public */
export function textToPlanValue(raw: string): PlanFeatureValue | undefined {
	const text = raw.trim();
	if (!text) return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return text;
	}
	if (typeof parsed === "number" || typeof parsed === "boolean" || typeof parsed === "string") return parsed;
	if (parsed !== null && typeof parsed === "object" && typeof (parsed as { base?: unknown }).base === "number") {
		return parsed as PlanFeatureValue;
	}
	return undefined;
}

/** Igual que `textToPlanValue`, pero para overrides: ahí no existe el valor escalable. */
export function textToFeatureValue(raw: string): FeatureValue | undefined {
	const value = textToPlanValue(raw);
	return value === undefined || typeof value === "object" ? undefined : value;
}

/** Mapa de valores → mapa de texto, para editarlo fila por fila. */
export function toTextMap(values: Record<string, PlanFeatureValue> = {}): Record<string, string> {
	return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, valueToText(value)]));
}

/** Vuelta del editor a valores de plan, separando las claves que no se pudieron interpretar. */
export function parseTextMap(texts: Record<string, string>): { values: Record<string, PlanFeatureValue>; invalid: string[] } {
	const values: Record<string, PlanFeatureValue> = {};
	const invalid: string[] = [];
	for (const [key, text] of Object.entries(texts)) {
		const value = textToPlanValue(text);
		if (value === undefined) invalid.push(key);
		else values[key] = value;
	}
	return { values, invalid };
}

/** Precio de lista legible. Sin precio, el plan no está a la venta. */
export function formatPrice(price?: PlanPrice): string {
	if (!price) return "—";
	return `${price.currency} ${(price.unitAmountMinor / 100).toFixed(2)}${price.perSeat ? " × asiento" : ""}`;
}
