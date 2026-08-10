import type { BroadcastInput, NotifyInput } from "./Notification.ts";
import type { CapabilityToken } from "../../security/Capability.ts";

/**
 * Contrato mínimo que exponen las notificaciones a sus **productores**.
 *
 * Otros servicios/presets emiten notificaciones resolviendo el servicio por
 * nombre y dependiendo de esta interfaz, nunca de la clase concreta del preset:
 *
 * ```ts
 * const notifications = this.tryGetMyService<INotificationService>("NotificationService");
 * await notifications?.notify({ userId, topic: "drive.shared", title, body, link });
 * ```
 *
 * Como el preset es opcional, `tryGetMyService` es justamente la variante correcta: devuelve
 * `undefined` en vez de lanzar si no está cargado. Requiere declararlo (con `optional: true`) en el
 * `config.json` del productor.
 */
export interface INotificationService {
	/**
	 * Persiste (canal inApp) y reparte la notificación por los canales resueltos.
	 * Para topics **reservados** (`security.*`) exige `cap` con scope `identity:internal`
	 * y deriva el `origin` de `cap.owner` (infalsificable); sin capability válida se
	 * descartan. Los topics normales no requieren `cap`.
	 */
	notify(input: NotifyInput, cap?: CapabilityToken): Promise<void>;
	/**
	 * Anuncio a TODOS los usuarios activos. Superficie privilegiada: exige capability
	 * con scope `notifications:broadcast`. Con cola encola UN job firmado (chunks
	 * reanudables, dedup por `broadcastId`); sin cola, fan-out directo.
	 */
	broadcast(cap: CapabilityToken, input: BroadcastInput): Promise<"queued" | "direct">;
}

/**
 * Contrato opcional para el **canal email**. `NotificationService` lo invoca por
 * duck-typing si el `EmailService` cargado lo implementa; si no, omite el canal
 * email sin romper. Mantiene a NotificationService desacoplado del preset de correo.
 */
export interface INotificationEmailSender {
	/** Envía un email transaccional del sistema (no-reply) al usuario destinatario. */
	sendSystemEmail(input: SystemEmailInput): Promise<void>;
	/**
	 * Política vigente, para rechazar ANTES de mutar lo que después no se va a poder entregar (ej.
	 * verificar una casilla externa con el envío externo deshabilitado). Opcional: un EmailService
	 * viejo no la expone y el productor cae en la garantía de entrega, que es el backstop real.
	 */
	getDeliveryPolicy?(): SystemEmailDeliveryPolicy;
}

/** Qué puede entregar hoy el servicio de correo. */
export interface SystemEmailDeliveryPolicy {
	/** `true` si sólo se entrega a buzones del dominio de la plataforma. */
	internalOnly: boolean;
	/** Dominio raíz de la plataforma (`<usuario>@<raíz>`, `<usuario>@<org>.<raíz>`). */
	rootDomain: string;
}

/**
 * Qué tiene que garantizar la entrega para darla por buena:
 *
 * - `"best-effort"` (default): con `internalOnly` puentea al buzón de plataforma y, sin buzón,
 *   omite en silencio. Correcto para avisos: una notificación no debe romper a su productor.
 * - `"any-mailbox"`: alguna casilla del titular (la registrada o su buzón de plataforma), o lanza.
 *   Para correos que son la única vía de acción que le queda a la persona (enlace de baja).
 * - `"exact"`: exactamente `to`, sin puentear jamás. Para los que prueban el control de esa
 *   casilla (confirmación de cambio de email); puentear haría la verificación un trámite vacío.
 */
export type SystemEmailDeliveryGuarantee = "best-effort" | "any-mailbox" | "exact";

export interface SystemEmailInput {
	/** Dirección personal del usuario (la que conoce el IdentityManager). */
	to: string;
	/**
	 * Usuario destinatario. Permite al `EmailService` resolver su buzón de la
	 * plataforma cuando el envío a direcciones externas está deshabilitado.
	 */
	userId?: string;
	subject: string;
	html: string;
	text?: string;
	/**
	 * Cabeceras extra. Existe por `List-Unsubscribe`/`List-Unsubscribe-Post` (RFC 2369 y 8058): la
	 * baja de un envío masivo tiene que estar en la cabecera para que el cliente de correo la
	 * ofrezca como acción propia. Las controla el productor; el `EmailService` sólo las transporta.
	 */
	headers?: Record<string, string>;
	/** Garantía de entrega exigida (default `"best-effort"`). Ver {@link SystemEmailDeliveryGuarantee}. */
	deliveryGuarantee?: SystemEmailDeliveryGuarantee;
}
