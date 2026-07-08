/**
 * Tipos compartidos del sistema de notificaciones.
 *
 * El backend vive en el preset `adc-notifications` (`NotificationService`); estos
 * tipos viven en `@common` para que cualquier productor (otros servicios/presets)
 * y la UI dependan del **contrato**, no de la clase concreta del preset.
 */

/** Canales de entrega de una notificación. */
export type NotificationChannel = "inApp" | "email" | "push";

/**
 * `topic` namespaced por app/feature: `<app>.<evento>` (ej. `drive.shared`,
 * `projects.mention`, `security.new_login`, `inbox.message`). Es un string abierto:
 * cada app registra y rotula los suyos en su panel federado de preferencias.
 */
export type NotificationTopic = `${string}.${string}`;

/** Notificación persistida y entregada al usuario (forma de bandeja). */
export interface Notification {
	id: string;
	/** Destinatario. */
	userId: string;
	orgId?: string | null;
	topic: NotificationTopic;
	title: string;
	body: string;
	/** Tag de icono (`adc-icon-...`) o URL, opcional. */
	icon?: string | null;
	/**
	 * Enlace al recurso relacionado. Si `linkApp` está presente, `link` es una
	 * **ruta** (`/issues/abc`) que el cliente resuelve al origen correcto según el
	 * entorno (dev: puerto; prod: subdominio). Si `linkApp` está ausente, `link` es
	 * una URL absoluta (enlace externo).
	 */
	link?: string | null;
	/** Id de app de plataforma (`projects`, `drive`, `mail`, `community`, …) para resolver `link` como ruta. */
	linkApp?: string | null;
	/** Payload arbitrario para el consumidor (ids, metadatos). */
	data?: Record<string, unknown> | null;
	/** Canales por los que se intentó/realizó la entrega. */
	channels: NotificationChannel[];
	/**
	 * Id del broadcast que la originó (`null` = dirigida). Índice único por
	 * `(userId, broadcastId)`: dedup ante reentregas de la cola.
	 */
	broadcastId?: string | null;
	/** Fecha de lectura; `null`/ausente = no leída. */
	readAt?: Date | null;
	createdAt: Date;
}

/** Preferencias de un usuario para un `topic` concreto (qué canales recibir). */
export interface NotificationPreference {
	userId: string;
	topic: NotificationTopic;
	inApp: boolean;
	email: boolean;
	push: boolean;
	updatedAt: Date;
}

/** Canales por defecto cuando el usuario no fijó preferencia para un topic. */
export const DEFAULT_CHANNELS: Readonly<Record<NotificationChannel, boolean>> = {
	inApp: true,
	email: false,
	push: false,
};

/**
 * Entrada que un productor pasa a `notify()`. Los canales se resuelven contra las
 * preferencias del usuario salvo que se fuercen explícitamente en `channels`.
 */
export interface NotifyInput {
	userId: string;
	topic: NotificationTopic;
	title: string;
	body: string;
	/**
	 * Nombre del módulo productor. Lo estampa `BaseModule.emitNotification` con su
	 * `name`; `NotificationService` lo usa para autorizar topics **reservados** (p.ej.
	 * `security.*`). Es atribución best-effort (un módulo que llame al `emitNotification`
	 * de bajo nivel podría forjarlo): la defensa fuerte de esos topics es el renderizado
	 * server-side del contenido, no este campo.
	 */
	origin?: string;
	orgId?: string;
	icon?: string;
	link?: string;
	/** App de plataforma para resolver `link` como ruta dev/prod (ver `Notification.linkApp`). */
	linkApp?: string;
	data?: Record<string, unknown>;
	/** Fuerza los canales ignorando las preferencias (úsese con criterio). */
	channels?: NotificationChannel[];
	/** Overrides para el canal email (si difiere de `title`/`body`). */
	email?: { subject?: string; html?: string };
	/**
	 * Si ya existe una notificación **no leída** del mismo `topic` para el usuario,
	 * NO crea otra (efecto "digest": una sola entrada hasta que la marque leída).
	 * Pensado para eventos recurrentes como correo entrante: avisás "tenés algo
	 * nuevo" una vez y no apilás una por cada ocurrencia.
	 */
	collapseUnread?: boolean;
}

/**
 * Anuncio a TODOS los usuarios activos. El productor no enumera destinatarios:
 * emite UNA entrada y `NotificationService` hace el fan-out por lotes reanudables.
 */
export interface BroadcastInput {
	/** Id único del anuncio (UUID del productor): clave de dedup por usuario. */
	broadcastId: string;
	topic: NotificationTopic;
	title: string;
	body: string;
	/** Módulo productor (lo estampa `BaseModule.emitBroadcast`). Sólo informativo: la autorización es la capability. */
	origin?: string;
	icon?: string;
	link?: string;
	/** App de plataforma para resolver `link` como ruta dev/prod (ver `Notification.linkApp`). */
	linkApp?: string;
	data?: Record<string, unknown>;
}

/** Evento que viaja por el stream SSE hacia el cliente (campana del header). */
export type NotificationStreamEvent =
	| { type: "ready"; unread: number }
	| { type: "notification"; unread: number; notification: Notification }
	| { type: "read"; unread: number };
