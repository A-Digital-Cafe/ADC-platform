/**
 * Escritor de PDF mínimo, sin dependencias, para los documentos legales versionados.
 *
 * A mano y no con una librería porque el PDF de una versión publicada **no se regenera nunca** (un
 * archivo congelado que cambia deja de probar algo): la salida tiene que ser determinística y no
 * depender de que una dependencia se comporte igual dentro de dos años.
 *
 * **Courier a propósito**: cortar líneas necesita las métricas de ancho de cada carácter, y con
 * Helvetica hay que embeber una tabla de 224 anchos donde un error se ve como texto desbordando el
 * margen. Courier mide exactamente 600/1000 del cuerpo, así que el cálculo es una multiplicación.
 */

const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const FONT_SIZE = 9;
const LINE_HEIGHT = 12.5;
/** Courier: todos los glifos miden 0.6 em. */
const CHAR_WIDTH = FONT_SIZE * 0.6;
const MAX_COLS = Math.floor((PAGE_WIDTH - MARGIN * 2) / CHAR_WIDTH);

/**
 * Unicode → WinAnsiEncoding para lo que no es Latin-1 directo. Lo que no esté acá ni en Latin-1
 * se degrada a un equivalente ASCII: un glifo faltante en un PDF sale como un cuadrito, y en un
 * documento legal eso es peor que una comilla recta.
 */
const WINANSI = new Map([
	["—", 0x97], // —
	["–", 0x96], // –
	["‘", 0x91],
	["’", 0x92],
	["“", 0x93],
	["”", 0x94],
	["…", 0x85], // …
	["•", 0x95], // •
	["€", 0x80], // €
]);

const ASCII_FALLBACK = new Map([
	[" ", " "],
	["→", "->"],
	["≥", ">="],
	["≤", "<="],
	["×", "x"],
	["✓", "OK"],
	["⚠", "!"],
]);

/** Texto → bytes WinAnsi, con escape de los caracteres que rompen un literal de cadena PDF. */
function encodeText(text) {
	const bytes = [];
	for (const ch of text) {
		const mapped = ASCII_FALLBACK.get(ch);
		if (mapped !== undefined) {
			for (const c of mapped) bytes.push(c.charCodeAt(0));
			continue;
		}
		const win = WINANSI.get(ch);
		const code = win ?? ch.codePointAt(0);
		if (code === undefined || code > 0xff) {
			bytes.push(0x3f); // '?' — mejor que un glifo vacío
			continue;
		}
		if (code === 0x28 || code === 0x29 || code === 0x5c) bytes.push(0x5c); // ( ) \
		bytes.push(code);
	}
	return Buffer.from(bytes);
}

/** Corta un párrafo en líneas de a lo sumo `cols` columnas, respetando palabras. */
export function wrap(text, cols) {
	const out = [];
	let line = "";
	for (const word of text.split(/\s+/).filter(Boolean)) {
		if (!line) {
			line = word;
		} else if (line.length + 1 + word.length <= cols) {
			line += ` ${word}`;
		} else {
			out.push(line);
			line = word;
		}
		// Una palabra sola más larga que el ancho (una URL) se parte a lo bruto: preferible a
		// dejarla salir del margen.
		while (line.length > cols) {
			out.push(line.slice(0, cols));
			line = line.slice(cols);
		}
	}
	if (line) out.push(line);
	return out.length > 0 ? out : [""];
}

/**
 * Bloques → PDF. Cada bloque es `{ style, text }`:
 * `title` | `heading` | `body` | `bullet` | `note` | `meta`.
 */
export function renderPdf({ title, subtitle, blocks, footer }) {
	/** @type {{ text: string; bold: boolean; indent: number; gapBefore: number }[]} */
	const lines = [];
	const push = (text, { bold = false, indent = 0, gapBefore = 0 } = {}) => {
		for (const [i, l] of wrap(text, MAX_COLS - indent).entries()) {
			lines.push({ text: l, bold, indent, gapBefore: i === 0 ? gapBefore : 0 });
		}
	};

	push(title, { bold: true });
	if (subtitle) push(subtitle, { gapBefore: 0.4 });

	for (const block of blocks) {
		if (!block.text.trim()) continue;
		switch (block.style) {
			case "heading":
				push(block.text, { bold: true, gapBefore: 1.2 });
				break;
			case "bullet":
				push(`- ${block.text}`, { indent: 2, gapBefore: 0.2 });
				break;
			case "note":
				push(`| ${block.text}`, { indent: 2, gapBefore: 0.6 });
				break;
			case "meta":
				push(block.text, { gapBefore: 0.6 });
				break;
			default:
				push(block.text, { gapBefore: 0.6 });
		}
	}

	// Paginado: alto útil dividido por interlineado, dejando sitio al pie.
	const usableHeight = PAGE_HEIGHT - MARGIN * 2 - LINE_HEIGHT * 2;
	/** @type {(typeof lines)[]} */
	const pages = [];
	let current = [];
	let used = 0;
	for (const line of lines) {
		const cost = LINE_HEIGHT * (1 + line.gapBefore);
		if (used + cost > usableHeight && current.length > 0) {
			pages.push(current);
			current = [];
			used = 0;
		}
		current.push(line);
		used += cost;
	}
	if (current.length > 0) pages.push(current);

	return assemble(pages, footer);
}

function contentStream(pageLines, footer, pageNumber, pageCount) {
	const parts = ["BT"];
	let y = PAGE_HEIGHT - MARGIN;
	let font = null;
	for (const line of pageLines) {
		y -= LINE_HEIGHT * (1 + line.gapBefore);
		const want = line.bold ? "/F2" : "/F1";
		if (want !== font) {
			parts.push(`${want} ${FONT_SIZE} Tf`);
			font = want;
		}
		parts.push(`1 0 0 1 ${(MARGIN + line.indent * CHAR_WIDTH).toFixed(2)} ${y.toFixed(2)} Tm`);
		parts.push(`(${encodeText(line.text).toString("latin1")}) Tj`);
	}
	// Pie en cada página: sin él, una hoja suelta del PDF no dice de qué documento salió.
	parts.push(`/F1 7 Tf`);
	parts.push(`1 0 0 1 ${MARGIN} ${MARGIN - 14} Tm`);
	parts.push(`(${encodeText(`${footer}  -  pagina ${pageNumber} de ${pageCount}`).toString("latin1")}) Tj`);
	parts.push("ET");
	return Buffer.from(parts.join("\n"), "latin1");
}

function assemble(pages, footer) {
	const objects = []; // 1-indexado por posición
	const add = (body) => {
		objects.push(body);
		return objects.length;
	};

	const catalogId = add(null); // 1, se rellena al final
	const pagesId = add(null); // 2
	const fontRegular = add(Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>", "latin1"));
	const fontBold = add(Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>", "latin1"));

	const pageIds = [];
	for (const [i, pageLines] of pages.entries()) {
		const stream = contentStream(pageLines, footer, i + 1, pages.length);
		const streamId = add(Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, "latin1"), stream, Buffer.from("\nendstream", "latin1")]));
		const pageId = add(
			Buffer.from(
				`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
					`/Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${streamId} 0 R >>`,
				"latin1"
			)
		);
		pageIds.push(pageId);
	}

	objects[catalogId - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`, "latin1");
	objects[pagesId - 1] = Buffer.from(
		`<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`,
		"latin1"
	);

	const chunks = [Buffer.from("%PDF-1.4\n", "latin1")];
	let offset = chunks[0].length;
	const offsets = [];
	for (const [i, body] of objects.entries()) {
		offsets.push(offset);
		const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, "latin1"), body, Buffer.from("\nendobj\n", "latin1")]);
		chunks.push(chunk);
		offset += chunk.length;
	}

	const xrefStart = offset;
	const xref = [`xref\n0 ${objects.length + 1}\n`, "0000000000 65535 f \n"];
	for (const o of offsets) xref.push(`${String(o).padStart(10, "0")} 00000 n \n`);
	chunks.push(Buffer.from(xref.join(""), "latin1"));
	chunks.push(Buffer.from(`trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`, "latin1"));

	return Buffer.concat(chunks);
}
