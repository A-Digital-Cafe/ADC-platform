import type { BroadcastInput, NotifyInput } from "./Notification.ts";
import type { CapabilityToken } from "../../security/Capability.ts";

/**
 * Contrato mínimo que exponen las notificaciones a sus **productores**.
 *
 * Otros servicios/presets emiten notificaciones resolviendo el servicio por
 * nombre y dependiendo de esta interfaz, nunca de la clase concreta del preset:
 *
 * ```ts
 * const notifications = this.kernel.registry.getService<INotificationService>("NotificationService");
 * await notifications?.notify({ userId, topic: "drive.shared", title, body, link });
 * ```
 *
 * Como el preset es opcional, el productor debe degradar si no está cargado
 * (`hasModule("service", "NotificationService")` o `try/catch`).
 */
export interface INotificationService {
	/** Persiste (canal inApp) y reparte la notificación por los canales resueltos. */
	notify(input: NotifyInput): Promise<void>;
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
	/** Envía un email transaccional del sistema (no-reply) a una dirección externa. */
	sendSystemEmail(input: SystemEmailInput): Promise<void>;
}

export interface SystemEmailInput {
	to: string;
	subject: string;
	html: string;
	text?: string;
}
