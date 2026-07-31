/**
 * Catálogo declarativo de features vendibles.
 *
 * Cada módulo declara qué features expone (`FeatureDef`) y con qué defaults por
 * tier (`ModulePlanDefaults`) al registrarse en `PlanService`; cada plan les
 * asigna su valor (`PlanDefinition.features`). Este catálogo es la capa editable
 * en runtime, persistida en Mongo; la oferta comercial real se publica encima
 * desde fuera del código, vía el bulk de administración de planes.
 *
 * Regla del eje organización: un valor puede escalar con los **asientos pagos**
 * (`{ base, perSeat }`). Un tier de org con límites planos es abusable — una org de
 * 3 miembros y una de 300 pagarían lo mismo consumiendo recursos muy distintos.
 */

/** Sentinela JSON-safe para "sin tope" (no usar `Infinity`: no serializa). */
export const UNLIMITED = -1;

/** Qué clase de restricción impone la feature. */
export type FeatureKind =
	/** Consumo medido en una ventana temporal (exports/mes, envíos/día). */
	| "quota"
	/** Tope instantáneo, sin ventana (bytes totales, capas por proyecto). */
	| "limit"
	/** Está o no está (dominio propio, unidades remotas). */
	| "flag"
	/** Variante cualitativa (`blur: "basic" | "full" | "advanced"`). */
	| "enum";

/** Ventana de medición de una feature `quota`. */
export type MeterWindow = "day" | "month" | "total";

/** Unidad del valor, para formatear en la UI y en la página de precios. */
export type FeatureUnit = "bytes" | "count" | "px";

/** Cómo escala el valor en el eje organización. */
export type OrgScaling = "fixed" | "perSeat";

/** Declaración de una feature por parte del módulo que la implementa. */
export interface FeatureDef {
	/** Identificador global, prefijado por módulo: `drive.maxFileSize`, `email.dailySend`. */
	key: string;
	/** Módulo dueño; agrupa la tabla comparativa de precios. */
	module: string;
	/** Clave i18n del nombre visible. */
	label: string;
	kind: FeatureKind;
	unit?: FeatureUnit;
	/** Sólo para `kind: "quota"`. */
	window?: MeterWindow;
	/** Si aparece en la página pública de precios. */
	salesVisible?: boolean;
	/** Default `"fixed"`. Ver {@link resolveFeatureValue}. */
	orgScaling?: OrgScaling;
}

/** Valor efectivo de una feature una vez resuelto para un sujeto concreto. */
export type FeatureValue = number | boolean | string;

/** Valor que escala con los asientos pagos: `base + perSeat × paidSeats`. */
export interface ScaledValue {
	base: number;
	/** Incremento por asiento pago. Ausente o `0` ⇒ equivale a un valor plano. */
	perSeat?: number;
}

/** Valor tal como se guarda en un plan (plano o escalable por asiento). */
export type PlanFeatureValue = FeatureValue | ScaledValue;

/** Los dos ejes de plan de la plataforma: cuenta personal y organización. */
export type PlanAxis = "user" | "org";

/**
 * Precio de lista de un plan.
 *
 * Vive en el plan y no en el módulo de cobro para que haya **una sola fuente**: el
 * catálogo público lo expone sin sesión (una página de precios tiene que mostrar
 * precios a un visitante anónimo) y el checkout cobra exactamente lo publicado.
 */
export interface PlanPrice {
	/** ISO 4217, ej. `"USD"`. */
	currency: string;
	/** Unidades menores **enteras** (centavos). Nunca float: los flotantes redondean plata. */
	unitAmountMinor: number;
	/** `true` en el eje org: el monto a cobrar es `unitAmountMinor × asientos`. */
	perSeat?: boolean;
}

/** Un plan: el conjunto de valores de features para un tier de un eje. */
export interface PlanDefinition {
	axis: PlanAxis;
	/** `AccountTier` si `axis === "user"`; `OrganizationTier` si `axis === "org"`. */
	tier: string;
	/**
	 * Precio de lista. Ausente ⇒ **el plan no está a la venta** (gratuito, o a medida
	 * como enterprise). Lo publica la oferta comercial; el código nunca lo siembra.
	 */
	price?: PlanPrice;
	/** Asientos incluidos sin suscripción activa. Sólo `axis: "org"`. */
	includedSeats?: number;
	/** Mínimo de asientos contratables. Sólo `axis: "org"`. */
	minSeats?: number;
	/** Máximo de asientos contratables. Sólo `axis: "org"`. */
	maxSeats?: number;
	features: Record<string, PlanFeatureValue>;
	/**
	 * Tope por **miembro** dentro de la organización, cuando no tiene un override
	 * propio. Evita que una sola persona se coma el pool compartido.
	 *
	 * Sólo `axis: "org"`. Se clampea siempre al valor de la organización, y un
	 * `UNLIMITED` significa "sin tope propio": el miembro llega hasta el de la org.
	 * Es la generalización del viejo `ORG_MEMBER_DEFAULT_BYTES` de storage, que
	 * sólo existía para bytes.
	 */
	memberFeatures?: Record<string, PlanFeatureValue>;
	/**
	 * Valores que reemplazan a los de `features` cuando la organización tiene la
	 * **ampliación** otorgada (override `org.expansion = true`).
	 *
	 * Amplía sólo los pools compartidos, no la calidad por persona ni la cantidad
	 * de asientos. Se pide por ticket, se otorga a criterio de la plataforma y es
	 * revocable si se detecta uso malintencionado.
	 */
	expansionFeatures?: Record<string, PlanFeatureValue>;
}

/**
 * Defaults de plan que un módulo aporta al catálogo al registrarse
 * (`IPlanService.registerFeatures`). Cada mapa va de **tier** a
 * `featureKey → valor`; el módulo sólo debe declarar SUS features.
 *
 * Son defaults de **desarrollo**, no la oferta comercial: ésta se publica por la API de
 * administración, que congela los planes (`seeded: false`) para que estos defaults no los pisen.
 */
export interface ModulePlanDefaults {
	/** Eje personal: `AccountTier` → features. */
	user?: Record<string, Record<string, PlanFeatureValue>>;
	/** Eje organización: `OrganizationTier` → features. */
	org?: Record<string, Record<string, PlanFeatureValue>>;
	/** Tope por miembro sin override propio: `OrganizationTier` → features. */
	orgMember?: Record<string, Record<string, PlanFeatureValue>>;
	/** Valores con la ampliación otorgada: `OrganizationTier` → features. */
	expansion?: Record<string, Record<string, PlanFeatureValue>>;
}

/** Clave de persistencia de un plan (`_id` en `plan_definitions`). */
export function planKey(axis: PlanAxis, tier: string): string {
	return `${axis}:${tier}`;
}

/** `true` si el valor viene expresado como escalable por asiento. */
export function isScaledValue(value: PlanFeatureValue): value is ScaledValue {
	return typeof value === "object" && value !== null && "base" in value;
}

/**
 * Resuelve el valor efectivo de una feature para una cantidad de asientos pagos.
 *
 * - Valor plano → se devuelve tal cual (los asientos no lo afectan).
 * - `{ base, perSeat }` → `base + perSeat × paidSeats`.
 * - `base === UNLIMITED` → sigue sin tope: escalar el infinito no tiene sentido.
 *
 * Función pura: es el núcleo testeable del modelo de asientos.
 */
export function resolveFeatureValue(value: PlanFeatureValue, paidSeats = 0): FeatureValue {
	if (!isScaledValue(value)) return value;
	if (value.base === UNLIMITED) return UNLIMITED;
	const seats = Number.isFinite(paidSeats) && paidSeats > 0 ? Math.floor(paidSeats) : 0;
	return value.base + (value.perSeat ?? 0) * seats;
}

/** `true` si el límite numérico no tiene tope. */
export function isUnlimited(limit: FeatureValue): boolean {
	return limit === UNLIMITED;
}

/** Unidades restantes de un límite numérico (`Infinity` si es ilimitado). */
export function remaining(limit: number, used: number): number {
	return isUnlimited(limit) ? Number.POSITIVE_INFINITY : Math.max(0, limit - used);
}
