/**
 * Reglas de MIME para servir archivos subidos por usuarios.
 *
 * El problema concreto: en un upload presignado el `Content-Type` **no va firmado**
 * (el SDK de S3 lo marca como header no-firmable), así que el cliente declara
 * `image/png` en la base de datos y sube lo que quiera. El tipo que S3 guarda y el
 * declarado pueden no coincidir, y al descargar `inline` es el guardado el que manda.
 */

/** Tipos exactos que un navegador renderiza sin ejecutar nada del contenido. */
const INLINE_SAFE_EXACT: ReadonlySet<string> = new Set(["application/pdf", "text/plain"]);

/**
 * `true` si el tipo se puede servir `inline` sin riesgo de ejecución en el origen que
 * lo sirve. Todo lo demás debe ir como `attachment`.
 *
 * `image/svg+xml` queda **fuera** a propósito aunque sea `image/`: un SVG es XML y puede
 * traer `<script>`, que corre con el origen de la descarga.
 */
export function isInlineSafeMime(mimeType: string | null | undefined): boolean {
	if (!mimeType) return false;
	const mime = mimeType.split(";")[0].trim().toLowerCase();
	if (mime === "image/svg+xml") return false;
	if (mime.startsWith("image/") || mime.startsWith("audio/") || mime.startsWith("video/")) return true;
	return INLINE_SAFE_EXACT.has(mime);
}
