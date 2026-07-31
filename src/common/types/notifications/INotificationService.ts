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
}

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
}
