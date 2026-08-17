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

	/** Avisa que se activó la verificación en dos pasos (topic `security.two_factor_enabled`). */
	async twoFactorEnabled(userId: string): Promise<void> {
		if (!userId) return;
		await this.#emit({
			userId,
			topic: "security.two_factor_enabled",
			title: "Activaste la verificación en dos pasos",
			body: "Guardá tus códigos de recuperación en un lugar seguro: son la única forma de entrar si perdés el autenticador.",
			channels: ["inApp", "email"],
			linkApp: "my-account",
			link: "/settings/privacy-security",
		});
	}

	/**
	 * Aviso de baja del segundo factor. El reseteo administrativo va por su **propio** topic y no
	 * por un texto distinto: el contenido lo pone la plantilla del servidor (anti-phishing), así que
	 * distinguir los dos casos exige distinguir el topic. Y hay que distinguirlos: un reseteo es
	 * indistinguible de uno hostil desde una cuenta de admin comprometida, y quien lo tiene que
	 * notar es el titular.
	 */
	async twoFactorDisabled(userId: string, opts?: { byAdmin?: boolean }): Promise<void> {
		if (!userId) return;
		await this.#emit({
			userId,
			topic: opts?.byAdmin ? "security.two_factor_reset" : "security.two_factor_disabled",
			title: opts?.byAdmin ? "Un administrador reseteó tu verificación en dos pasos" : "Desactivaste la verificación en dos pasos",
			body: "Tu cuenta vuelve a entrar sólo con contraseña. Si no fuiste vos, cambiala y contactá a soporte de inmediato.",
			channels: ["inApp", "email"],
			linkApp: "my-account",
			link: "/settings/privacy-security",
		});
	}

	/**
	 * Avisa a la casilla ACTUAL (el cambio aún no se aplicó) que se pidió cambiar el email. Es la
	 * ventana de reacción ante un pedido hostil con sesión robada: sale en el momento del pedido,
	 * antes de que el token pueda canjearse.
	 */
	async emailChangeRequested(userId: string, opts: { maskedNewEmail: string }): Promise<void> {
		if (!userId) return;
		await this.#emit({
			userId,
			topic: "security.email_change_requested",
			title: "Pediste cambiar el email de tu cuenta",
			body: "Enviamos un enlace de confirmación a la casilla nueva. Si no fuiste vos, cambiá tu contraseña y contactá a soporte de inmediato.",
			channels: ["inApp", "email"],
			linkApp: "my-account",
			link: "/settings/privacy-security",
			data: { maskedNewEmail: opts.maskedNewEmail },
		});
	}

	/** Confirmación de que el email de la cuenta cambió (el canal email ya llega a la casilla nueva). */
	async emailChanged(userId: string): Promise<void> {
		if (!userId) return;
		await this.#emit({
			userId,
			topic: "security.email_changed",
			title: "El email de tu cuenta fue cambiado",
			body: "Si no fuiste vos, contactá a soporte de inmediato.",
			channels: ["inApp", "email"],
			linkApp: "my-account",
			link: "/settings/privacy-security",
		});
	}

	/**
	 * Aviso de cambio de username. Si con él se renombró la casilla hay que decirlo: la dirección
	 * desde la que la persona escribe y a la que recibe cambió, y eso no se descubre solo.
	 */
	async usernameChanged(userId: string, opts?: { mailboxRenamed?: boolean }): Promise<void> {
		if (!userId) return;
		await this.#emit({
			userId,
			topic: "security.username_changed",
			title: "Tu nombre de usuario fue cambiado",
			body:
				(opts?.mailboxRenamed ? "Tu dirección de correo de la plataforma se actualizó al nombre nuevo. " : "") +
				"Si no fuiste vos, contactá a soporte de inmediato.",
			channels: ["inApp", "email"],
			linkApp: "my-account",
			link: "/settings/privacy-security",
		});
	}

	/**
	 * Aviso de baja programada. Sólo canal email: la cuenta ya no puede entrar a ver la bandeja.
	 * La baja VOLUNTARIA recuerda las dos vías de arrepentimiento (volver a entrar y el enlace de
	 * un solo uso); la administrativa no es cancelable por la persona y va sin ninguna.
	 */
	async accountDeletionScheduled(
		userId: string,
		opts: { scheduledFor?: Date | string | null; cancelUrl?: string | null; byAdmin?: boolean }
	): Promise<void> {
		if (!userId) return;
		const fecha = opts.scheduledFor ? new Date(opts.scheduledFor).toISOString().slice(0, 10) : null;
		const cuando = fecha ? ` el ${fecha}` : " en 30 días";
		const base = opts.byAdmin
			? `Un administrador dio de baja tu cuenta. Se eliminará definitivamente${cuando}, junto con tus datos personales.`
			: `Registramos tu solicitud de baja. Tu cuenta quedó desactivada y se eliminará definitivamente${cuando}, junto con tus datos personales.`;
		let arrepentimiento = "";
		if (!opts.byAdmin) {
			arrepentimiento = " Si te arrepentís, volvé a iniciar sesión antes de esa fecha y tu cuenta queda como estaba";
			arrepentimiento += opts.cancelUrl ? ", o cancelá la baja desde el botón de este correo (enlace de un solo uso)." : ".";
		}
		await this.#emit({
			userId,
			topic: "account.deletion_scheduled",
			title: "Tu cuenta va a ser eliminada",
			body: base + arrepentimiento,
			channels: ["email"],
			// URL absoluta a la página pública de cancelación (sin `linkApp`: no es ruta interna).
			link: opts.cancelUrl ?? undefined,
		});
	}

	/** Confirmación de que la baja fue cancelada y la cuenta reactivada. */
	async accountDeletionCancelled(userId: string): Promise<void> {
		if (!userId) return;
		await this.#emit({
			userId,
			topic: "account.deletion_cancelled",
			title: "La baja de tu cuenta fue cancelada",
			body: "Tu cuenta vuelve a estar activa y no se va a eliminar. Si no pediste esta cancelación, contactá a soporte de inmediato.",
			channels: ["inApp", "email"],
		});
	}

	/**
	 * Alerta de seguridad para el equipo (Admins + Security Managers globales),
	 * topic `security.alert`: ban aplicado/levantado, rol modificado/eliminado,
	 * usuario eliminado, sesiones revocadas. Best-effort y sin lanzar; excluye al
	 * actor (ya sabe lo que hizo).
	 */
	async securityEvent(event: { title: string; body: string; actorId?: string; data?: Record<string, unknown> }): Promise<void> {
		await this.#fanoutToSecurityTeam(
			{
				topic: "security.alert",
				title: event.title,
				body: event.body,
				linkApp: "identity",
				link: "/users",
				data: event.data,
			},
			event.actorId
		);
	}

	/**
	 * Aviso al equipo (mismos destinatarios que `securityEvent`) de que un módulo
	 * quedó en fallo repetido (circuit breaker del kernel abierto), topic
	 * `security.module_failure`. El detalle (módulo, último error) viaja en `data`;
	 * el texto visible es la plantilla canónica del servidor.
	 */
	async moduleFailure(event: { module: string; error: string }): Promise<void> {
		await this.#fanoutToSecurityTeam({
			topic: "security.module_failure",
			title: "Fallo de módulo en la plataforma",
			body: `El módulo '${event.module}' está fallando repetidamente.`,
			data: { module: event.module, error: event.error },
		});
	}

	/**
	 * Aviso al equipo (mismos destinatarios) de que apareció un módulo NUEVO en runtime,
	 * topic `security.module_detected`. El módulo quedó PENDIENTE (no se ejecutó): el
	 * aviso pide revisarlo y lanzarlo (o eliminarlo) desde el gestor de módulos.
	 */
	async moduleDetected(event: { module: string; layer: string; filePath: string; preset: string | null }): Promise<void> {
		await this.#fanoutToSecurityTeam({
			topic: "security.module_detected",
			title: "Módulo nuevo detectado en la plataforma",
			body: `Se detectó el ${event.layer} '${event.module}' en runtime. NO se ejecutó: está pendiente de lanzamiento en el gestor de módulos.`,
			data: { module: event.module, layer: event.layer, filePath: event.filePath, preset: event.preset },
		});
	}

	/**
	 * Aviso al equipo (mismos destinatarios) de que un módulo cambió sus privilegios entre dos
	 * provisiones, topic `security.module_privileges`. El caso real es un `git pull` cuyo
	 * `config.json` pide scopes que el módulo no tenía: sin este aviso el cambio se aplica
	 * sin dejar rastro. `withheld` sale no vacío cuando el gate de aprobación los retuvo.
	 */
	async modulePrivilegesChanged(event: { module: string; layer: string; filePath: string; added: string[]; withheld: string[] }): Promise<void> {
		const retenidos = event.withheld.length ? ` No se concedieron (falta aprobación): ${event.withheld.join(", ")}.` : "";
		await this.#fanoutToSecurityTeam({
			topic: "security.module_privileges",
			title: "Cambio de privilegios de un módulo",
			body: `El ${event.layer} '${event.module}' pidió privilegios nuevos: ${event.added.join(", ") || "—"}.${retenidos}`,
			data: { module: event.module, layer: event.layer, filePath: event.filePath, added: event.added, withheld: event.withheld },
		});
	}

	/**
	 * Aviso al equipo (mismos destinatarios) de que se desplegó una versión nueva de los Términos
	 * o de la Política de Privacidad, topic `security.legal_docs_updated`.
	 *
	 * El aviso a las personas usuarias ya salió solo (broadcast `platform.legal` desde
	 * SessionManagerService); éste es la copia para el equipo, que necesita saber que el cambio se
	 * desplegó y se anunció sin tener que mirar los logs.
	 */
	async legalDocsUpdated(event: { changed: string[]; termsVersion: string; privacyVersion: string }): Promise<void> {
		await this.#fanoutToSecurityTeam({
			topic: "security.legal_docs_updated",
			title: "Cambió un documento legal de la plataforma",
			body: `Se publicó una versión nueva de: ${event.changed.join(", ")}. Ya se anunció a las personas usuarias.`,
			data: { changed: event.changed, termsVersion: event.termsVersion, privacyVersion: event.privacyVersion },
		});
	}

	/**
	 * Aviso al equipo (mismos destinatarios) de que un chequeo de integridad de la infraestructura
	 * pasó a **fallar**, topic `security.integrity_failed`.
	 *
	 * Lo emite el barrido de `NetworkService` en el flanco, no en cada pasada: un almacenamiento al
	 * que le falta una copia o un Redis que no puede volcar a disco siguen respondiendo verde a
	 * cualquier healthcheck, así que este aviso es lo único que separa "se rompió algo" de "se
	 * descubrió meses después".
	 */
	async integrityFailure(event: { checkId: string; title: string; nodeId: string; detail: string }): Promise<void> {
		await this.#fanoutToSecurityTeam({
			topic: "security.integrity_failed",
			title: "Fallo de integridad en la infraestructura",
			body: `${event.title} (nodo ${event.nodeId}): ${event.detail}`,
			data: { checkId: event.checkId, nodeId: event.nodeId, detail: event.detail },
		});
	}

	/** Fan-out best-effort a los destinatarios de seguridad, excluyendo opcionalmente al actor. */
	async #fanoutToSecurityTeam(input: Omit<NotifyInput, "userId">, excludeUserId?: string): Promise<void> {
		let recipients: string[];
		try {
			recipients = await this.#resolveSecurityRecipients();
		} catch {
			return; // resolver caído: no bloquear la operación de origen
		}
		const targets = [...new Set(recipients)].filter((id) => id && id !== excludeUserId);
		await Promise.allSettled(targets.map((userId) => this.#emit({ ...input, userId })));
	}
}
