/**
 * Vocabulario del clúster: qué es un nodo y qué puede pedirle un módulo al `ClusterService`.
 *
 * Vive en `@common` porque lo consumen tres capas que no pueden importarse entre sí: el servicio
 * que lo publica, el panel que lo muestra y los módulos que necesitan saber en qué nodo corre una
 * conexión para rutear hacia él.
 */

/** Entrada de un nodo vivo en el registro. Se refresca por latido y vence sola. */
export interface ClusterNode {
	/** Identificador estable e inmutable (`ADC_NODE_ID`). Clave en afinidades y auditoría. */
	id: string;
	/** Etiqueta legible. Cambiable sin consecuencias; no la usa nada técnico. */
	displayName: string;
	/** Sitio/zona física. Se usa para preferir el nodo más cercano al rutear. */
	site: string;
	/** Etiqueta legible del sitio. */
	siteName: string;
	/** Asimétricos: sólo el primario corre watchers, detección de módulos, git y scheduler. */
	role: "primary" | "secondary";
	/** `host:puerto` por el que los otros nodos lo alcanzan, o `null` si no se declaró. */
	advertise: string | null;
	/** Identidad del build de UI que sirve este nodo (ver la afinidad por `build-id`). */
	buildId: string | null;
	/** ISO 8601 del arranque del proceso. */
	bootedAt: string;
	/** Versión de la plataforma que corre. */
	version: string;
	/** `true` cuando terminó de arrancar y puede recibir tráfico. */
	ready: boolean;
	/**
	 * `standby` = el nodo está vivo y comandable pero **no sirve tráfico de aplicación**: arrancó
	 * sin cargar apps y `/healthz` responde 503. Distinto de `ready: false`, que es transitorio.
	 */
	power: "on" | "standby";
	/**
	 * Presión del proceso, de 0 a 100, o ausente si el nodo no la publica (versión anterior).
	 *
	 * Sale del retraso del event loop, no del CPU del host: mide si las requests están esperando,
	 * que es lo único que justifica pasarle trabajo a un vecino. Ver `@common/utils/load-signal.ts`.
	 */
	load?: number;
}

/** Mensaje que un nodo emite al resto por el bus del clúster. */
export interface ClusterEvent<T = unknown> {
	/** Qué pasó. Convención `<dominio>.<hecho>`: `cache.invalidate`, `notifications.publish`. */
	topic: string;
	/** Nodo que lo emitió. Se usa para descartar el propio eco. */
	origin: string;
	payload: T;
}

/** Handler de un evento recibido del bus. */
export type ClusterEventHandler<T = unknown> = (event: ClusterEvent<T>) => void | Promise<void>;

/**
 * Lo que un módulo puede pedirle al clúster. Se resuelve por nombre
 * (`tryGetMyService<IClusterService>("ClusterService")`) y **siempre de forma opcional**: en un
 * despliegue de un nodo el servicio existe igual, pero un módulo que lo exija dejaría de arrancar
 * si el clúster se deshabilitara.
 */
export interface IClusterService {
	/** Identidad de ESTE nodo. */
	self(): ClusterNode;
	/** Nodos vivos según el registro, incluido éste. */
	nodes(): Promise<ClusterNode[]>;
	/**
	 * Emite un evento al resto de los nodos. **No lo recibe el emisor**: el eco propio es la
	 * fuente más común de bucles de invalidación.
	 */
	publish<T>(topic: string, payload: T): Promise<void>;
	/** Se suscribe a un topic. Devuelve la función para darse de baja. */
	subscribe<T>(topic: string, handler: ClusterEventHandler<T>): () => void;
	/**
	 * Dónde está la conexión viva de un recurso (`sse:user:<id>`, `tunnel:device:<id>`), para
	 * poder reenviarle un request al nodo que la sostiene. `null` si nadie la reclamó.
	 */
	whereIs(resource: string): Promise<string | null>;
	/** Reclama para este nodo la conexión de un recurso, con vencimiento. */
	claim(resource: string, ttlSeconds: number): Promise<void>;
	/** Suelta la reclamación (al cerrarse la conexión). */
	release(resource: string): Promise<void>;
}
