import type { NotifyInput } from "@common/types/notifications/Notification.ts";

/** Emisor desacoplado inyectado por el servicio (envuelve `BaseModule.emitNotification`). */
export type NotifyEmitter = (input: NotifyInput) => Promise<void>;

/**
 * Notificaciones de dominio de identidad/seguridad. Mantiene `index.ts` como base
 * del servicio: las notificaciones son una feature aislada que sólo depende de un
 * emisor best-effort (`emitNotification`), no de los managers de datos.
 */
export class NotifyManager {
	readonly #emit: NotifyEmitter;

	constructor(emit: NotifyEmitter) {
		this.#emit = emit;
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
}
