/**
 * Parseo de la cabecera `Range` (RFC 9110 §14).
 *
 * Lo consumen los endpoints de contenido de Drive (vía `contentRangePlan` del preset) para
 * responder `206`/`416` y para cobrar el egreso por lo realmente servido; vive en `@common` para
 * que quien responde y quien mide interpreten el header igual. El rango se empuja hasta el
 * productor (`Range` a S3; en cifrados, los chunks de attachments): cobrar el tramo mientras se
 * sirve el archivo entero sería un bypass de cuota.
 *
 * El resto de los streams de la plataforma ignora `Range` (200 completo, válido por RFC); ver
 * `EndpointManagerService/parts/http.ts`.
 */

/** Rango pedido, ya acotado al tamaño real del recurso. */
export interface ByteRange {
	start: number;
	end: number;
}

/**
 * Interpreta `bytes=a-b`, `bytes=a-` y `bytes=-n` contra un recurso de `size` bytes.
 *
 * - `null`: sin rango (o sintaxis que no entendemos) ⇒ responder el recurso entero.
 * - `"unsatisfiable"`: rango fuera del recurso ⇒ `416`.
 *
 * Sólo un rango: los multipart no los pide ningún cliente de la plataforma.
 */
export function parseByteRange(header: string | undefined, size: number): ByteRange | "unsatisfiable" | null {
	if (!header || size <= 0) return null;
	const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
	if (!match) return null;

	const [, rawStart, rawEnd] = match;
	if (!rawStart && !rawEnd) return null;

	let start: number;
	let end: number;
	if (rawStart) {
		start = Number(rawStart);
		end = rawEnd ? Math.min(Number(rawEnd), size - 1) : size - 1;
	} else {
		// Sufijo: los últimos N bytes.
		const suffix = Number(rawEnd);
		if (suffix <= 0) return "unsatisfiable";
		start = Math.max(0, size - suffix);
		end = size - 1;
	}

	if (start > end || start >= size) return "unsatisfiable";
	return { start, end };
}

/** Bytes que se van a transferir para ese `Range` (el recurso entero si no hay rango válido). */
export function rangeLength(header: string | undefined, size: number): number {
	const parsed = parseByteRange(header, size);
	if (parsed === null) return size;
	if (parsed === "unsatisfiable") return 0;
	return parsed.end - parsed.start + 1;
}
