import type { NotificationChannel, NotificationTopic } from "../../types/notifications/Notification.js";

/**
 * Topics de **plataforma**: los avisos que ADC manda a todas las personas usuarias, no a una por
 * un evento suyo. Viven en `@common` porque tres lados necesitan la misma lista y ninguno puede
 * importar a los otros: el panel de preferencias de `adc-notifications`, el compositor de anuncios
 * de `adc-modules-manager` y el `PreferenceManager` que decide qué se puede apagar.
 *
 * No son topics reservados (`security.*`): esos los renderiza el servidor y van al equipo interno.
 * Estos los redacta un admin y llegan a todo el mundo, así que la protección relevante no es
 * anti-spoofing sino **qué puede silenciar la persona usuaria**.
 */

export interface PlatformTopicDef {
	topic: NotificationTopic;
	/** Rótulo corto para el panel de preferencias y el selector de anuncios. */
	label: string;
	/** Por qué existe el topic; se muestra bajo el rótulo para que la elección sea informada. */
	description: string;
	/**
	 * Canales que la persona usuaria **no puede desactivar**. Vacío = todo opcional.
	 *
	 * No es un capricho de producto: para `platform.legal` los Términos comprometen a anunciar con
	 * antelación los cambios que recortan beneficios, y la constancia de aceptación queda ligada a
	 * una versión concreta. Un aviso que se puede silenciar no cumple ese compromiso. El resto de
	 * los canales sí son opcionales, y las novedades lo son por entero: ese es el derecho de
	 * oposición del art. 21 RGPD, y vaciarlo convertiría el interés legítimo en un pretexto.
	 */
	mandatoryChannels: readonly NotificationChannel[];
}

export const PLATFORM_TOPICS = {
	legal: {
		topic: "platform.legal",
		label: "Cambios en los Términos y la Política de Privacidad",
		description:
			"Aviso obligatorio cuando se publica una versión nueva de los documentos que aceptaste. El aviso en la app no se puede desactivar; el correo sí.",
		mandatoryChannels: ["inApp"],
	},
	announcement: {
		topic: "platform.announcement",
		label: "Novedades y mantenimiento de la plataforma",
		description: "Funciones nuevas, avisos de mantenimiento y novedades del servicio. Podés desactivarlo entero cuando quieras.",
		mandatoryChannels: [],
	},
} as const satisfies Record<string, PlatformTopicDef>;

/** Lista estable para iterar en la UI (orden: primero lo obligatorio). */
export const PLATFORM_TOPIC_LIST: readonly PlatformTopicDef[] = [PLATFORM_TOPICS.legal, PLATFORM_TOPICS.announcement];

/** Topics que un anuncio broadcast puede usar. Cualquier otro se rechaza en el endpoint. */
export const BROADCASTABLE_TOPICS: readonly NotificationTopic[] = PLATFORM_TOPIC_LIST.map((t) => t.topic);

/**
 * Canales que no se pueden desactivar para un topic. Devuelve vacío para cualquier topic que no
 * sea de plataforma: la regla es una excepción acotada, no el comportamiento por defecto.
 */
export function mandatoryChannelsFor(topic: string): readonly NotificationChannel[] {
	return PLATFORM_TOPIC_LIST.find((t) => t.topic === topic)?.mandatoryChannels ?? [];
}
