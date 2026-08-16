export const NETWORK_RESOURCE_NAME = "network" as const;

// Scope (bitfield)

/**
 * Scopes del recurso `network` (infraestructura del clúster, bitfield). Recurso **global-only**:
 * la red y los motores de datos son de la plataforma, nunca de una organización — un admin de
 * organización no administra el hierro sobre el que corre.
 *
 * Se separa de `modules.runtime`, que para y arranca módulos (reversible en un click), porque esto
 * apaga máquinas, reconfigura replica sets y reparte credenciales de la red privada.
 *
 * - `NODES`: lista de nodos, sus etiquetas y el runbook de alta.
 * - `TOPOLOGY`: dónde viven los datos (replica set, layout del storage, réplicas de Redis y broker)
 *   y su conversión — `EXECUTE` es el que cambia la topología de verdad.
 * - `VPN`: la red overlay (peers, claves de alta, políticas y rutas).
 * - `INTEGRITY`: informes de verificación de integridad de la infraestructura y los objetos.
 * - `LIFECYCLE`: apagar y drenar nodos. Bit propio y no derivado de `NODES` porque leer la lista
 *   de máquinas y poder apagarlas son permisos de distinto tamaño.
 * - `ROUTING`: los nombres públicos del borde (subdominios enrutados por el túnel). Bit propio
 *   porque publica superficie en internet: quien lo tiene puede colgar un host nuevo del dominio,
 *   que es una operación de otra naturaleza que mirar la topología o repartir claves de la overlay.
 */
export const NetworkScopes = {
	NONE: 0,
	NODES: 1, // 1
	TOPOLOGY: 1 << 1, // 2
	VPN: 1 << 2, // 4
	INTEGRITY: 1 << 3, // 8
	LIFECYCLE: 1 << 4, // 16
	ROUTING: 1 << 5, // 32
	ALL: 1 | (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 5), // 63
} as const;

/** @public */
export type NetworkScopeValue = (typeof NetworkScopes)[keyof typeof NetworkScopes];
