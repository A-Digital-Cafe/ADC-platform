import type { NotifyInput } from "@common/types/notifications/Notification.ts";

/** Emisor desacoplado inyectado por el servicio (envuelve `BaseModule.emitNotification`). */
export type NotifyEmitter = (input: NotifyInput) => Promise<void>;

/** Resuelve los destinatarios de alertas de seguridad (Admins + Security Managers globales). */
export type SecurityRecipientsResolver = () => Promise<string[]>;

/**
 * Notificaciones de dominio de identidad/seguridad. Mantiene `index.ts` como base
 * del servicio: las notificaciones son una feature aislada que sólo depende de un
 * emisor best-effort (`emitNotification`), no de los managers de datos.
 */
export class NotifyManager {
	readonly #emit: NotifyEmitter;
	#resolveSecurityRecipients: SecurityRecipientsResolver = async () => [];

	constructor(emit: NotifyEmitter) {
		this.#emit = emit;
	}

	/** Inyecta el resolver de destinatarios (se setea en start(), cuando existen los modelos). */
	setSecurityRecipientsResolver(resolver: SecurityRecipientsResolver): void {
		this.#resolveSecurityRecipients = resolver;
	}

	/** Avisa al usuario que su contraseña cambió (topic de seguridad `security.password_changed`). */
	async passwordChanged(userId: string): Promise<void> {
		if (!userId) return;
		await this.#emit({
			userId,
			topic: "security.password_changed",
			title: "Tu contraseña fue cambiada",
			body: "Si no fuiste vos, contactá a soporte de inmediato.",
			channels: ["inApp", "email"],
			linkApp: "my-account",
			link: "/settings/privacy-security",
		});
	}

	/**
	 * Alerta de seguridad para el equipo (Admins + Security Managers globales),
	 * topic `security.alert`: ban aplicado/levantado, rol modificado/eliminado,
	 * usuario eliminado, sesiones revocadas. Best-effort y sin lanzar; excluye al
	 * actor (ya sabe lo que hizo).
	 */
	async securityEvent(event: { title: string; body: string; actorId?: string; data?: Record<string, unknown> }): Promise<void> {
		let recipients: string[];
		try {
			recipients = await this.#resolveSecurityRecipients();
		} catch {
			return; // resolver caído: no bloquear la operación de origen
		}
		const targets = [...new Set(recipients)].filter((id) => id && id !== event.actorId);
		await Promise.allSettled(
			targets.map((userId) =>
				this.#emit({
					userId,
					topic: "security.alert",
					title: event.title,
					body: event.body,
					linkApp: "identity",
					link: "/users",
					data: event.data,
				})
			)
		);
	}
}
