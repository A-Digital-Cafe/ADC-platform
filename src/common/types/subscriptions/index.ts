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
	currency: string;
	/** Precio unitario en unidades menores enteras (centavos). Nunca float. */
	unitAmountMinor: number;
	/** Asientos pagos. Siempre 1 en el eje usuario. */
	paidSeats: number;
	/** Baja de asientos que aplica en la próxima renovación. */
	pendingSeats?: number;
	currentPeriodEnd?: string;
	cancelledAt?: string;
	createdAt: string;
	updatedAt: string;
}

/** Evento de pasarela ya verificado y normalizado. */
export interface NormalizedEvent {
	gateway: GatewayId;
	/** Identificador del evento en la pasarela. Clave de idempotencia. */
	eventId: string;
	kind: "payment.approved" | "payment.rejected" | "subscription.cancelled";
	/** Suscripción de la pasarela a la que pertenece el evento. */
	externalSubscriptionId: string;
	amountMinor?: number;
	currency?: string;
	/** Fin del período que este pago cubre. */
	periodEnd?: string;
}

/** Lo que la UI necesita para mostrar y contratar planes. */
export interface SubscriptionSummary {
	subscription: Subscription | null;
	/** Pasarelas habilitadas en esta instalación. */
	gateways: GatewayId[];
}
