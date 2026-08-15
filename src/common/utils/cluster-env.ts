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
 * Sitio (ubicación física) del nodo: qué máquinas comparten el corte de luz y el enlace. Se usa para
 * preferir el nodo más cercano al rutear y como raíz de la zona de replicación del almacenamiento
 * (`<sitio>-<ordinal>`): el sitio distingue ubicaciones, la zona máquinas dentro de una ubicación.
 *
 * Cambiarlo con datos adentro obliga a rehacer el layout: tan inmutable como {@link nodeId}.
 */
export function nodeSite(): string {
	const declared = env("ADC_NODE_SITE");
	return declared && SLUG.test(declared) ? declared : DEFAULT_SITE;
}

/**
 * Sitio por defecto. Un nombre de región y no `default`: termina como prefijo de la zona del
 * almacenamiento (`sa-central-1`), y una zona `default-1` no dice nada al repartir copias.
 */
const DEFAULT_SITE = "sa-central";

/** Etiqueta legible del sitio ("Casa"). Cambiable, como {@link nodeName}. */
export function siteName(): string {
	return env("ADC_SITE_NAME") ?? nodeSite();
}

/**
 * Rol decidido desde el panel, si lo hay. Este módulo **no lee archivos** a propósito —lo importan
 * caminos muy tempranos y también el navegador—, así que lo resuelve `node-state.ts` y lo instala acá.
 */
let roleOverride: NodeRole | null = null;

/**
 * Instala (o quita, con `null`) el rol que decidió el panel. La llama el kernel **antes** de que
 * nada consulte el rol: `shouldRunInfraCompose` lo usa en los primeros milisegundos del arranque.
 */
export function setNodeRoleOverride(role: NodeRole | null): void {
	roleOverride = role;
}

/**
 * Rol del nodo. **Default `primary`**: un despliegue que nunca oyó hablar de esto se comporta
 * exactamente como antes. Sólo un `secondary` explícito apaga subsistemas.
 *
 * Lo que decidió el panel ({@link setNodeRoleOverride}) le gana a `ADC_NODE_ROLE`: promover un
 * secundario se hace cuando el primario se rompió, y ahí no se depende de editar un archivo.
 */
export function nodeRole(): NodeRole {
	if (roleOverride) return roleOverride;
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
 * Stacks que **sólo** levanta el nodo primario, por alias. Los dos son planos de control únicos por
 * definición: dos coordinadores de overlay repartiendo direcciones sobre la misma red, o dos
 * clústers de config servers con el catálogo de qué dato vive en qué shard, son dos mapas distintos
 * del mismo territorio — y el segundo arranca vacío sin que nada avise. Forzarlo acá hace imposible
 * el olvido de excluirlos al copiar el `.env` de otra máquina.
 */
const PRIMARY_ONLY_COMPOSES = new Set(["netbird", "mongo-shard"]);

/**
 * Stacks que hay que **nombrar** en `ADC_INFRA_COMPOSE` para que arranquen: ni `*` ni la variable
 * sin definir los incluyen. A diferencia de los cinco históricos, éstos no sirven para nada recién
 * levantados —hace falta dominio y certificado uno, un `sh.addShard` el otro— y sin eso sólo
 * descargan cientos de megas y ocupan puertos en cada clon del repo.
 */
const OPT_IN_COMPOSES = new Set(["netbird", "mongo-shard"]);

/**
 * ¿Levanta este nodo el `docker-compose.yml` de `src/common/docker/<dirName>`?
 *
 * `selection` sin definir o `*` = todos (comportamiento histórico). Vacío = ninguno, que es lo que
 * evita que un segundo nodo levante su propio Mongo por accidente. Una lista acepta tanto el nombre
 * del directorio como su alias corto (`mongo` ≡ `adc-mongo-core`).
 *
 * Las dos excepciones se resuelven antes que nada: {@link PRIMARY_ONLY_COMPOSES} nunca en un
 * secundario, {@link OPT_IN_COMPOSES} sólo si el alias está escrito.
 */
export function shouldRunInfraCompose(dirName: string, selection?: string): boolean {
	const alias = composeAlias(dirName);
	if (PRIMARY_ONLY_COMPOSES.has(alias) && !isPrimary()) return false;
	// `selection` la resuelve `node-state.ts` (en producción, lo que decidió el panel).
	const raw = selection ?? process.env.ADC_INFRA_COMPOSE;
	if (raw === undefined) return !OPT_IN_COMPOSES.has(alias);
	const tokens = raw
		.split(",")
		.map((t) => t.trim().toLowerCase())
		.filter(Boolean);
	const dir = dirName.toLowerCase();
	const named = tokens.some((token) => token === dir || token === alias || composeAlias(token) === alias);
	if (OPT_IN_COMPOSES.has(alias)) return named;
	if (tokens.includes("*")) return true;
	if (tokens.length === 0) return false;
	return named;
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
