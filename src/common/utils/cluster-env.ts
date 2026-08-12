/**
 * Identidad, rol y sitio de ESTE proceso dentro del clúster.
 *
 * Es una de las excepciones documentadas de `process.env` (misma familia que
 * `@common/utils/runtime-env.ts`): son banderas del proceso —qué es este nodo—, no configuración de
 * un módulo, y las necesita el kernel antes de que exista ningún `config.json` interpolado.
 *
 * **Todos los defaults reproducen el comportamiento de un solo nodo**: sin ninguna variable puesta,
 * este proceso es `primary`, levanta toda la infraestructura y no reenvía nada. Sumar un nodo es
 * aditivo, no una migración.
 */

import { hostname } from "node:os";

/** Roles asimétricos: el primario es el único con watchers, git, docker y scheduler. */
export type NodeRole = "primary" | "secondary";

/** Forma admitida para los identificadores estables (`ADC_NODE_ID`, `ADC_NODE_SITE`). */
const SLUG = /^[a-z0-9][a-z0-9_-]{0,62}$/i;

/** Cache del hostname: `os.hostname()` hace una syscall y esto se consulta en cada heartbeat. */
let cachedHostFallback: string | null = null;

function env(name: string): string | undefined {
	const value = process.env[name]?.trim();
	return value || undefined;
}

/**
 * Identificador **estable e inmutable** del nodo. Es clave en el registro de Redis, en el audit log
 * y en las afinidades de conexión (`sse:user:<id> → nodeId`), así que cambiarlo en un nodo vivo deja
 * esas referencias colgadas. Para la etiqueta que se lee en pantalla está {@link nodeName}.
 *
 * Sin `ADC_NODE_ID` cae al hostname de la máquina: es estable entre reinicios y único en una LAN,
 * que es lo que se necesita para arrancar sin configurar nada.
 */
export function nodeId(): string {
	const declared = env("ADC_NODE_ID");
	if (declared && SLUG.test(declared)) return declared;
	cachedHostFallback ??= hostname().split(".")[0] || "nodo";
	return cachedHostFallback;
}

/** `true` si `ADC_NODE_ID` está puesto pero no es un slug usable (lo avisa el banner de arranque). */
export function hasInvalidNodeId(): boolean {
	const declared = env("ADC_NODE_ID");
	return declared !== undefined && !SLUG.test(declared);
}

/**
 * Etiqueta legible del nodo ("Torre del living"). Texto libre y cambiable sin consecuencias: no la
 * usa nada técnico. En runtime, el nombre que muestra el panel puede venir de la base y ganarle a
 * esta variable — ésta es sólo la semilla.
 */
export function nodeName(): string {
	return env("ADC_NODE_NAME") ?? nodeId();
}

/**
 * Sitio (ubicación física) del nodo. Se usa como **zona de replicación del almacenamiento de
 * objetos** y para preferir el nodo más cercano al rutear, así que cambiarlo obliga a rehacer el
 * layout: es tan inmutable como {@link nodeId}.
 */
export function nodeSite(): string {
	const declared = env("ADC_NODE_SITE");
	return declared && SLUG.test(declared) ? declared : "default";
}

/** Etiqueta legible del sitio ("Casa"). Cambiable, como {@link nodeName}. */
export function siteName(): string {
	return env("ADC_SITE_NAME") ?? nodeSite();
}

/**
 * Rol del nodo. **Default `primary`**: un despliegue que nunca oyó hablar de esta variable se
 * comporta exactamente como antes. Sólo un `secondary` explícito apaga subsistemas.
 */
export function nodeRole(): NodeRole {
	return env("ADC_NODE_ROLE")?.toLowerCase() === "secondary" ? "secondary" : "primary";
}

/** `true` en el nodo que corre watchers, detección de módulos, deploys git y el scheduler. */
export function isPrimary(): boolean {
	return nodeRole() === "primary";
}

/**
 * Dirección por la que los otros nodos alcanzan a éste (`host:puerto`), o `null` si no se declaró.
 * Sin esto el nodo se registra igual pero nadie puede reenviarle tráfico.
 */
export function advertisedAddress(): string | null {
	return env("ADC_NODE_ADVERTISE") ?? null;
}

/** `true` si este nodo debe reenviar a sus vecinos lo que no sabe servir (`ClusterGatewayService`). */
export function clusterGatewayEnabled(): boolean {
	return env("ADC_CLUSTER_GATEWAY")?.toLowerCase() === "true";
}

/**
 * Normaliza el nombre de un directorio de `src/common/docker` a su alias corto
 * (`adc-mongo-core` → `mongo`), para que `ADC_INFRA_COMPOSE=mongo,redis` sea legible y no obligue a
 * escribir los nombres completos.
 */
function composeAlias(dirName: string): string {
	return dirName.replace(/^adc-/, "").replace(/-core$/, "").toLowerCase();
}

/**
 * ¿Levanta este nodo el `docker-compose.yml` de `src/common/docker/<dirName>`?
 *
 * `ADC_INFRA_COMPOSE` sin definir o `*` = todos (comportamiento histórico). Vacío = ninguno, que es
 * lo que evita que un segundo nodo levante su propio Mongo por accidente. Una lista acepta tanto el
 * nombre del directorio como su alias corto (`mongo` ≡ `adc-mongo-core`).
 */
export function shouldRunInfraCompose(dirName: string): boolean {
	const raw = process.env.ADC_INFRA_COMPOSE;
	if (raw === undefined) return true;
	const tokens = raw
		.split(",")
		.map((t) => t.trim().toLowerCase())
		.filter(Boolean);
	if (tokens.includes("*")) return true;
	if (tokens.length === 0) return false;
	const dir = dirName.toLowerCase();
	const alias = composeAlias(dirName);
	return tokens.some((token) => token === dir || token === alias || composeAlias(token) === alias);
}

/** Identidad del nodo resuelta, para el banner de arranque. No decide nada. */
export interface ClusterIdentity {
	id: string;
	name: string;
	site: string;
	siteName: string;
	role: NodeRole;
	advertise: string | null;
	gateway: boolean;
	/** Qué composes de infraestructura levanta este nodo, tal como se declaró. */
	infra: string;
}

/** Snapshot de {@link ClusterIdentity} para loguear al arrancar. */
export function resolveClusterIdentity(): ClusterIdentity {
	return {
		id: nodeId(),
		name: nodeName(),
		site: nodeSite(),
		siteName: siteName(),
		role: nodeRole(),
		advertise: advertisedAddress(),
		gateway: clusterGatewayEnabled(),
		infra: process.env.ADC_INFRA_COMPOSE?.trim() || "*",
	};
}
