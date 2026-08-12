import type { IClusterService } from "@common/types/cluster/ICluster.ts";

/**
 * Puerta por la que un hub de conexiones publica en qué nodo vive cada una.
 *
 * Existe para que los hubs (el canal SSE de un dispositivo, las conexiones de un usuario) no
 * tengan que saber que del otro lado hay un clúster: reclaman y sueltan, y con un solo nodo eso
 * no existe. Es **sincrónica** aunque `claim`/`release` no lo sean, porque se invoca desde el alta
 * de un socket, desde el latido y desde el cierre — tres caminos donde esperar a Redis sólo agrega
 * latencia a algo que ya es best-effort.
 */
export interface ConnectionAffinity {
	/** Marca el recurso como sostenido por ESTE nodo; repetirlo renueva el vencimiento. */
	claim(resource: string): void;
	/** Lo suelta al cerrarse la conexión. */
	release(resource: string): void;
}

/**
 * Devuelve `null` cuando no hay `ClusterService`, para que el hub escriba `#affinity?.claim(...)`
 * y no un `if` en cada llamada: sin clúster nadie pregunta `whereIs` y no hay nada que publicar.
 */
export function createConnectionAffinity(cluster: IClusterService | undefined | null, ttlSeconds: number): ConnectionAffinity | null {
	if (!cluster) return null;
	// Los errores se tragan a propósito: un Redis caído ya se ve en el latido del registro de
	// nodos, y una afinidad que no se pudo escribir sólo devuelve el ruteo a "atiende el que
	// recibió", que es el comportamiento sin clúster. Propagarlos, en cambio, se llevaría puesta
	// la conexión, que es lo único que acá importa de verdad.
	return {
		claim: (resource) => void cluster.claim(resource, ttlSeconds).catch(() => undefined),
		release: (resource) => void cluster.release(resource).catch(() => undefined),
	};
}
