/**
 * Fan-in entre nodos: pedirle a un vecino **la vista que sólo él tiene**.
 *
 * Hay dos datos del panel que no viven en ninguna base compartida porque no deben vivir ahí: el
 * ring buffer de logs (`/privacy` promete que es en memoria y que no se escribe a disco ni se
 * manda a terceros) y el consumo del proceso, que es del proceso. Con un nodo eso da igual; con
 * dos, el panel muestra el nodo que atendió el request y nadie sabe cuál es. La salida es
 * consultarle al vecino EN VIVO, sin agregar ni guardar nada.
 *
 * **Autenticación del salto**: se reenvían las credenciales del propio operador (cookie de sesión
 * o `Authorization`), no un secreto entre nodos. Es la misma postura del `ClusterGatewayService`,
 * que pasa la request tal cual y deja que el vecino autentique al usuario final: como el
 * `JWT_SECRET` es uno de los secretos que el alta de nodo exige idénticos, el vecino valida la
 * misma sesión y vuelve a exigir el mismo permiso. Un secreto nuevo sólo movería la autorización
 * de "quién sos" a "qué máquina sos", que es estrictamente más débil para un dato personal como
 * un log.
 *
 * No usa `@common/utils/http-proxy.ts` a propósito: eso mueve bytes en streaming entre sockets
 * crudos y acá lo que hace falta es un JSON chico con timeout.
 */

import type { ClusterNode } from "@common/types/cluster/ICluster.ts";
import { HttpError } from "@common/types/ADCCustomError.ts";

/**
 * Marca del nodo que pidió el fan-in. Es el corta-bucles: lo que llega marcado se sirve local
 * pase lo que pase, así un `?node=` que se colara en el salto no puede rebotar entre dos nodos.
 */
const FANIN_BY = "x-adc-fanin-by";

/** Un vecino que no contesta rápido no vale la pena: el panel prefiere el error al spinner. */
const DEFAULT_TIMEOUT_MS = 5_000;

/** Llamada de sólo lectura al endpoint equivalente de otro nodo. */
export interface NodeCall {
	/** Destino, tal como lo publicó el registro: de ahí sale `advertise`. */
	node: ClusterNode;
	/** Quién pregunta. Va en el header del corta-bucles, así el vecino puede loguear de dónde vino. */
	origin: string;
	/** Ruta absoluta del endpoint del vecino, sin query. */
	path: string;
	/** Filtros ya parseados. Nunca incluye el selector de nodo: el salto es de uno solo. */
	query?: Record<string, string | number | undefined>;
	/** Headers del request original. De acá salen las credenciales del operador, y nada más. */
	headers: Record<string, string | undefined>;
	/** IP real del cliente: sin esto el rate limit del vecino cuenta contra el nodo, no contra quien pide. */
	clientIp?: string;
	timeoutMs?: number;
}

/**
 * A qué nodo hay que pedirle el dato: `null` = a este mismo (el caso normal y el de un solo nodo).
 *
 * Falla explicando en vez de degradar a local en silencio: pedir el nodo B y recibir el A sin
 * aviso es peor que un error, porque el dato se lee como si fuera del que se pidió.
 */
export function resolveNodeTarget(
	nodes: ClusterNode[],
	requested: string | undefined,
	selfId: string,
	headers: Record<string, string | undefined>
): ClusterNode | null {
	if (headers[FANIN_BY]) return null;
	if (!requested || requested === selfId) return null;
	const node = nodes.find((n) => n.id === requested);
	if (!node) {
		throw new HttpError(404, "NODE_NOT_FOUND", `No hay ningún nodo vivo con el identificador '${requested}'.`);
	}
	if (!node.advertise) {
		throw new HttpError(
			409,
			"NODE_NOT_REACHABLE",
			`El nodo '${node.displayName}' no declaró cómo alcanzarlo (ADC_NODE_ADVERTISE), así que no se le puede consultar nada.`
		);
	}
	return node;
}

/** `host:puerto` → URL. Plano y no TLS: el puerto del kernel no se publica, el tráfico entra por el balanceador. */
function urlFor(call: NodeCall): string {
	const url = new URL(`http://${call.node.advertise}${call.path}`);
	for (const [key, value] of Object.entries(call.query ?? {})) {
		if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
	}
	return url.toString();
}

/**
 * Consulta el endpoint equivalente del vecino y devuelve su cuerpo.
 *
 * El error del vecino se propaga como 502 con su motivo adentro: un 403 del otro nodo no es un
 * 403 de este request —el operador sí tiene permiso acá—, y devolverlo tal cual mandaría al panel
 * a pedir login.
 */
export async function callNode<T>(call: NodeCall): Promise<T> {
	const { node } = call;
	const headers: Record<string, string> = { accept: "application/json", [FANIN_BY]: call.origin };
	// Sólo las credenciales: reenviar el resto arrastraría `host`, `content-length` y compañía, que
	// describen OTRA request y confunden al vecino.
	if (call.headers.cookie) headers.cookie = call.headers.cookie;
	if (call.headers.authorization) headers.authorization = call.headers.authorization;
	if (call.clientIp) headers["x-forwarded-for"] = call.clientIp;

	let response: Response;
	try {
		response = await fetch(urlFor(call), {
			headers,
			signal: AbortSignal.timeout(call.timeoutMs ?? DEFAULT_TIMEOUT_MS),
		});
	} catch (error) {
		throw new HttpError(
			502,
			"NODE_UNREACHABLE",
			`No se pudo consultar al nodo '${node.displayName}' en ${node.advertise}: ${(error as Error).message}`
		);
	}
	if (!response.ok) {
		throw new HttpError(
			502,
			"NODE_QUERY_FAILED",
			`El nodo '${node.displayName}' respondió ${response.status} a la consulta de ${call.path}.`
		);
	}
	return (await response.json()) as T;
}
