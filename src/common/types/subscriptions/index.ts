/**
 * Contrato compartido de suscripciones. Vive en `@common` para que la app UI del
 * preset `adc-subscriptions` y cualquier otro módulo lo consuman sin importar la
 * clase concreta del servicio.
 *
 * Modelo de cobro:
 * - El plan otorgado **expira solo**: `IdentityManagerService` ya tiene el cron que
 *   revierte un `tierGrant` vencido. Renovar = volver a otorgar. Eso evita tener que
 *   escribir dunning, prorrateo ni estados intermedios.
 * - En el eje organización el monto es `precioPorAsiento × paidSeats`, **sin
 *   prorrateo**: el asiento nuevo se cobra por período completo y el monto recurrente
 *   se ajusta en la renovación.
 */

/** Pasarelas soportadas. PayPal existe para exportación de servicios en USD. */
export type GatewayId = "mercadopago" | "paypal";

export type SubjectType = "user" | "org";

export type SubscriptionStatus =
	/** Alta creada, esperando el primer pago aprobado. */
	| "pending"
	| "active"
	/** El cobro falló; el plan sigue vigente hasta `currentPeriodEnd`. */
	| "past_due"
	/** Dada de baja; no se renueva (el plan cae solo al expirar). */
	| "cancelled";

/**
 * Cotización oficial con la que un precio de catálogo se expresa en la moneda de
 * cobro. Se guarda **con la operación**: es la prueba de qué tipo de cambio se
 * aplicó, y permite publicar el precio citando la fuente y la fecha.
 */
export interface FxQuote {
	/** Moneda del catálogo (ISO 4217). */
	base: string;
	/** Moneda en la que se cobra (ISO 4217). */
	quote: string;
	/** Unidades de `quote` que vale una de `base`. */
	rate: number;
	/** Organismo que la publica, ej. `"BCRA"`. */
	source: string;
	/** Fecha de la cotización según la fuente (`YYYY-MM-DD`). */
	quoteDate: string;
	/** Cuándo se trajo. Puede ser vieja: ante un fallo se conserva la última válida. */
	fetchedAt: string;
}

export interface BillingProfile {
	/**
	 * País de residencia fiscal **declarado por quien contrata** (ISO 3166-1 alpha-2). Es el que
	 * decide el comprobante, porque el que corresponde es el de la residencia real y no el del
	 * lugar desde donde se conectó: una VPN o un viaje no cambian dónde tributa una persona.
	 */
	country?: string;
	/**
	 * País que dedujo Cloudflare por IP. No decide nada: se guarda como constancia junto a la
	 * declaración, para que una discrepancia se pueda revisar después.
	 */
	detectedCountry?: string;
	name?: string;
	address?: string;
	/** Identificación fiscal en el país de residencia. */
	taxId?: string;
}

export interface Subscription {
	id: string;
	subjectType: SubjectType;
	subjectId: string;
	/** Plan contratado: `<axis>:<tier>`, la misma clave que usa `PlanService`. */
	planKey: string;
	gateway: GatewayId;
	/** Identificador de la suscripción en la pasarela (preapproval de MP, etc.). */
	externalId: string;
	status: SubscriptionStatus;
	/** Moneda en la que se cobra realmente (la de liquidación de la pasarela). */
	currency: string;
	/** Precio unitario en unidades menores enteras (centavos). Nunca float. */
	unitAmountMinor: number;
	/** Moneda del catálogo, si hubo conversión. */
	listCurrency?: string;
	/** Precio de lista en su moneda original, si hubo conversión. */
	listUnitAmountMinor?: number;
	/** Cotización aplicada al contratar. Ausente ⇒ no hubo conversión. */
	fx?: FxQuote;
	/**
	 * Datos fiscales de quien contrata, capturados en el checkout. Determinan el comprobante:
	 * país `AR` o desconocido ⇒ Factura C; cualquier otro ⇒ Factura E (exportación de servicios),
	 * que además exige nombre y domicilio porque en la E no existe el consumidor final.
	 */
	billing?: BillingProfile;
	/** Asientos pagos. Siempre 1 en el eje usuario. */
	paidSeats: number;
	/** Baja de asientos que aplica en la próxima renovación. */
	pendingSeats?: number;
	currentPeriodEnd?: string;
	/**
	 * Última contratación aceptada (cada checkout la reescribe: alta, recontratación
	 * o cambio de asientos). Es el arranque del plazo de revocación, y el corte de qué
	 * pagos entran en el reintegro. Distinto de `createdAt`, que es el alta original.
	 */
	contractedAt?: string;
	/**
	 * Primer pago aprobado de la contratación vigente. Corre el plazo de revocación
	 * hasta él por ser posterior (art. 34 LDC: ante la duda, lo más favorable al consumidor).
	 */
	firstPaidAt?: string;
	cancelledAt?: string;
	/** Momento en que se ejerció el derecho de revocación. */
	withdrawnAt?: string;
	createdAt: string;
	updatedAt: string;
}

/** @public Evento de pasarela ya verificado y normalizado. */
export interface NormalizedEvent {
	gateway: GatewayId;
	/** Identificador del evento en la pasarela. Clave de idempotencia. */
	eventId: string;
	kind: "payment.approved" | "payment.rejected" | "subscription.cancelled";
	/** Suscripción de la pasarela a la que pertenece el evento. */
	externalSubscriptionId: string;
	/**
	 * Id del **pago** en la pasarela. Se guarda porque el reintegro se pide sobre el
	 * pago, no sobre la suscripción (MP: `POST /v1/payments/{id}/refunds`).
	 */
	gatewayPaymentId?: string;
	amountMinor?: number;
	currency?: string;
	/** Fin del período que este pago cubre. */
	periodEnd?: string;
}

/** Estado del reintegro de una revocación. */
export type RefundStatus =
	/** No había nada cobrado que devolver. */
	| "not_required"
	/** La pasarela aceptó el reintegro. */
	| "refunded"
	/** La pasarela falló: la revocación vale igual y el reintegro queda en cola manual. */
	| "pending";

/** Constancia del ejercicio del derecho de revocación (arts. 34 LDC y 1110 CCyC). */
export interface WithdrawalRecord {
	id: string;
	subscriptionId: string;
	subjectType: SubjectType;
	subjectId: string;
	/** Usuario que la pidió. */
	requestedBy: string;
	requestedAt: string;
	gateway: GatewayId;
	/** Pagos reembolsados en la pasarela. */
	refundedPaymentIds: string[];
	/** Total reintegrado, en unidades menores de `currency`. */
	amountMinor: number;
	currency: string;
	refundStatus: RefundStatus;
	/** Último error de la pasarela, si el reintegro quedó pendiente. */
	lastError?: string;
	completedAt?: string;
}

/** Estado del derecho de revocación para el sujeto del contexto. */
export interface WithdrawalInfo {
	/** El plazo sigue abierto y hay una suscripción revocable. */
	available: boolean;
	/** Días corridos del plazo. */
	windowDays: number;
	/** Vencimiento del plazo (ISO). `null` si no hay suscripción. */
	deadline: string | null;
	/** Cuándo se ejerció, si ya se ejerció. */
	exercisedAt?: string;
	refundStatus?: RefundStatus;
}

/** Qué datos fiscales pedir en el checkout y con qué valores arrancar el formulario. */
export interface BillingOptions {
	/** ISO alpha-2 facturables. La UI los nombra con `Intl.DisplayNames`, así que no viajan traducidos. */
	countries: string[];
	/** País deducido por IP: sólo el valor inicial del selector, que se puede cambiar. */
	detectedCountry: string | null;
	/** Mercado interno: el único país que se factura con Factura C y no pide domicilio. */
	domesticCountry: string;
}

/** Lo que la UI necesita para mostrar y contratar planes. */
export interface SubscriptionSummary {
	subscription: Subscription | null;
	/** Pasarelas habilitadas en esta instalación. */
	gateways: GatewayId[];
	withdrawal: WithdrawalInfo;
	billing: BillingOptions;
}

/**
 * Con qué se convierte el catálogo a precio operativo. Es público (la página de
 * precios se ve sin sesión).
 */
export interface FxSettlement {
	/** Moneda en la que cobra la pasarela. `null` ⇒ no hay pasarela configurada. */
	settlementCurrency: string | null;
	/**
	 * Cotización vigente. `null` ⇒ no hay ninguna conocida: un plan cuyo precio esté
	 * en otra moneda **no se puede contratar** y la UI lo muestra como no disponible.
	 */
	quote: FxQuote | null;
}

/**
 * Superficie mínima del servicio de suscripciones que consumen otros módulos del
 * núcleo. Vive acá para que `IdentityManagerService` cancele el débito automático
 * al dar de baja una cuenta sin importar la clase del preset (que puede no estar).
 */
export interface ISubscriptionService {
	/** `false` si no había suscripción activa. */
	cancelFor(userId: string, orgId: string | null): Promise<boolean>;
}
