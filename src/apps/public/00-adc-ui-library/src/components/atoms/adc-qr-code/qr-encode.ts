/**
 * Codificador QR mínimo: modo byte, corrección de errores nivel M, versiones 1 a 10.
 *
 * Existe para no sumar una dependencia por un solo uso (el QR del segundo factor, ~120 caracteres),
 * y acotado a ese uso: 213 bytes de capacidad, que es la versión 10. Un texto más largo lanza en vez
 * de degradar en silencio a un código ilegible.
 *
 * Referencia: ISO/IEC 18004. La nomenclatura sigue la del estándar (módulos, máscaras, penalización).
 */

/** Nivel M: capacidad total en codewords, codewords de corrección por bloque, y cantidad de bloques. */
const VERSIONS: ReadonlyArray<{ total: number; ecPerBlock: number; blocks: number }> = [
	{ total: 26, ecPerBlock: 10, blocks: 1 }, // v1
	{ total: 44, ecPerBlock: 16, blocks: 1 },
	{ total: 70, ecPerBlock: 26, blocks: 1 },
	{ total: 100, ecPerBlock: 18, blocks: 2 },
	{ total: 134, ecPerBlock: 24, blocks: 2 },
	{ total: 172, ecPerBlock: 16, blocks: 4 },
	{ total: 196, ecPerBlock: 18, blocks: 4 },
	{ total: 242, ecPerBlock: 22, blocks: 4 },
	{ total: 292, ecPerBlock: 22, blocks: 5 },
	{ total: 346, ecPerBlock: 26, blocks: 5 }, // v10
];

/** Centros de los patrones de alineación por versión (v1 no tiene). */
const ALIGNMENT_CENTERS: ReadonlyArray<readonly number[]> = [
	[],
	[6, 18],
	[6, 22],
	[6, 26],
	[6, 30],
	[6, 34],
	[6, 22, 38],
	[6, 24, 42],
	[6, 26, 46],
	[6, 28, 50],
];

/** Palabra de versión (18 bits con BCH), obligatoria desde la v7. */
const VERSION_BITS: Readonly<Record<number, number>> = { 7: 0x07c94, 8: 0x085bc, 9: 0x09a99, 10: 0x0a4d3 };

/** Palabra de formato (15 bits con BCH) para nivel M, una por máscara. */
const FORMAT_BITS_M = [0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0];

const BYTE_MODE = 0b0100;
const PAD_BYTES = [0xec, 0x11];

/** Las ocho máscaras del estándar, indexadas por su identificador. */
const MASKS: ReadonlyArray<(row: number, col: number) => boolean> = [
	(r, c) => (r + c) % 2 === 0,
	(r) => r % 2 === 0,
	(_r, c) => c % 3 === 0,
	(r, c) => (r + c) % 3 === 0,
	(r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
	(r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
	(r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
	(r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

// ── Aritmética en GF(256), primitivo 0x11D ──────────────────────────────────

function gfMultiply(a: number, b: number): number {
	let result = 0;
	for (let i = 7; i >= 0; i--) {
		result = (result << 1) ^ ((result >>> 7) * 0x11d);
		result ^= ((b >>> i) & 1) * a;
	}
	return result & 0xff;
}

/** Coeficientes del polinomio generador de grado `degree` (mónico, sin el término principal). */
function rsDivisor(degree: number): number[] {
	const result = new Array<number>(degree).fill(0);
	result[degree - 1] = 1;

	let root = 1;
	for (let i = 0; i < degree; i++) {
		for (let j = 0; j < degree; j++) {
			result[j] = gfMultiply(result[j], root);
			if (j + 1 < degree) result[j] ^= result[j + 1];
		}
		root = gfMultiply(root, 0x02);
	}
	return result;
}

function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
	const result = new Array<number>(divisor.length).fill(0);
	for (const byte of data) {
		const factor = byte ^ result.shift()!;
		result.push(0);
		for (const [i, coefficient] of divisor.entries()) result[i] ^= gfMultiply(coefficient, factor);
	}
	return result;
}

// ── Flujo de datos ──────────────────────────────────────────────────────────

/** Capacidad en bytes del modo byte, ya descontados el indicador de modo y el contador. */
function byteCapacity(version: number): number {
	const spec = VERSIONS[version - 1];
	const dataBits = (spec.total - spec.ecPerBlock * spec.blocks) * 8;
	const headerBits = 4 + (version <= 9 ? 8 : 16);
	return Math.floor((dataBits - headerBits) / 8);
}

function pickVersion(byteLength: number): number {
	for (let version = 1; version <= VERSIONS.length; version++) {
		if (byteLength <= byteCapacity(version)) return version;
	}
	throw new Error(`Texto demasiado largo para un QR v${VERSIONS.length} (máx ${byteCapacity(VERSIONS.length)} bytes)`);
}

/** Cabecera + datos + terminador + relleno, ya en codewords. */
function buildDataCodewords(bytes: Uint8Array, version: number): number[] {
	const spec = VERSIONS[version - 1];
	const capacityBits = (spec.total - spec.ecPerBlock * spec.blocks) * 8;
	const bits: number[] = [];

	const push = (value: number, length: number) => {
		for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
	};

	push(BYTE_MODE, 4);
	push(bytes.length, version <= 9 ? 8 : 16);
	for (const byte of bytes) push(byte, 8);

	// Terminador de hasta 4 ceros, recortado si no entra, y relleno hasta cerrar el byte.
	push(0, Math.min(4, capacityBits - bits.length));
	push(0, (8 - (bits.length % 8)) % 8);

	const codewords: number[] = [];
	for (let i = 0; i < bits.length; i += 8) {
		codewords.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));
	}
	// Relleno alternado 0xEC/0x11 hasta llenar la capacidad. La alternancia se cuenta desde el
	// PRIMER byte de relleno —siempre 0xEC—, no desde la paridad de lo ya escrito.
	for (let pad = 0; codewords.length * 8 < capacityBits; pad++) codewords.push(PAD_BYTES[pad % 2]);

	return codewords;
}

/** Parte en bloques, agrega corrección de errores a cada uno y los entrelaza como manda el estándar. */
function addEccAndInterleave(data: readonly number[], version: number): number[] {
	const { total, ecPerBlock, blocks: numBlocks } = VERSIONS[version - 1];
	const shortBlockLen = Math.floor(total / numBlocks);
	const numShortBlocks = numBlocks - (total % numBlocks);
	const divisor = rsDivisor(ecPerBlock);

	const blocks: number[][] = [];
	for (let i = 0, offset = 0; i < numBlocks; i++) {
		const dataLen = shortBlockLen - ecPerBlock + (i < numShortBlocks ? 0 : 1);
		const chunk = data.slice(offset, offset + dataLen);
		offset += dataLen;
		const ecc = rsRemainder(chunk, divisor);
		// Hueco en los bloques cortos para que el entrelazado quede alineado; se saltea al leer.
		blocks.push([...chunk, ...(i < numShortBlocks ? [0] : []), ...ecc]);
	}

	const result: number[] = [];
	for (let i = 0; i < blocks[0].length; i++) {
		for (const [j, block] of blocks.entries()) {
			if (i !== shortBlockLen - ecPerBlock || j >= numShortBlocks) result.push(block[i]);
		}
	}
	return result;
}

// ── Matriz ──────────────────────────────────────────────────────────────────

interface Canvas {
	size: number;
	modules: boolean[][];
	/** Módulos de patrón fijo: no llevan datos ni se enmascaran. */
	reserved: boolean[][];
}

function createCanvas(version: number): Canvas {
	const size = version * 4 + 17;
	return {
		size,
		modules: Array.from({ length: size }, () => new Array<boolean>(size).fill(false)),
		reserved: Array.from({ length: size }, () => new Array<boolean>(size).fill(false)),
	};
}

function setFunction(canvas: Canvas, row: number, col: number, dark: boolean): void {
	if (row < 0 || col < 0 || row >= canvas.size || col >= canvas.size) return;
	canvas.modules[row][col] = dark;
	canvas.reserved[row][col] = true;
}

function drawFinder(canvas: Canvas, row: number, col: number): void {
	for (let dr = -4; dr <= 4; dr++) {
		for (let dc = -4; dc <= 4; dc++) {
			const distance = Math.max(Math.abs(dr), Math.abs(dc));
			setFunction(canvas, row + dr, col + dc, distance !== 2 && distance !== 4);
		}
	}
}

function drawAlignment(canvas: Canvas, row: number, col: number): void {
	for (let dr = -2; dr <= 2; dr++) {
		for (let dc = -2; dc <= 2; dc++) {
			setFunction(canvas, row + dr, col + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
		}
	}
}

function drawFunctionPatterns(canvas: Canvas, version: number): void {
	const { size } = canvas;

	for (let i = 0; i < size; i++) {
		setFunction(canvas, 6, i, i % 2 === 0);
		setFunction(canvas, i, 6, i % 2 === 0);
	}

	drawFinder(canvas, 3, 3);
	drawFinder(canvas, 3, size - 4);
	drawFinder(canvas, size - 4, 3);

	const centers = ALIGNMENT_CENTERS[version - 1];
	for (const [i, row] of centers.entries()) {
		for (const [j, col] of centers.entries()) {
			// Las tres esquinas ya las ocupan los patrones de búsqueda.
			const atFinder = (i === 0 && j === 0) || (i === 0 && j === centers.length - 1) || (i === centers.length - 1 && j === 0);
			if (!atFinder) drawAlignment(canvas, row, col);
		}
	}

	// Reservar el área de formato (se escribe al final, ya elegida la máscara) y el módulo fijo.
	drawFormatBits(canvas, 0);
	if (version >= 7) drawVersionBits(canvas, version);
}

function drawFormatBits(canvas: Canvas, mask: number): void {
	const { size } = canvas;
	const bits = FORMAT_BITS_M[mask];
	const bit = (i: number) => ((bits >>> i) & 1) !== 0;

	for (let i = 0; i <= 5; i++) setFunction(canvas, i, 8, bit(i));
	setFunction(canvas, 7, 8, bit(6));
	setFunction(canvas, 8, 8, bit(7));
	setFunction(canvas, 8, 7, bit(8));
	for (let i = 9; i < 15; i++) setFunction(canvas, 8, 14 - i, bit(i));

	for (let i = 0; i < 8; i++) setFunction(canvas, 8, size - 1 - i, bit(i));
	for (let i = 8; i < 15; i++) setFunction(canvas, size - 15 + i, 8, bit(i));
	setFunction(canvas, size - 8, 8, true); // módulo siempre oscuro
}

function drawVersionBits(canvas: Canvas, version: number): void {
	const bits = VERSION_BITS[version];
	for (let i = 0; i < 18; i++) {
		const dark = ((bits >>> i) & 1) !== 0;
		const a = canvas.size - 11 + (i % 3);
		const b = Math.floor(i / 3);
		setFunction(canvas, b, a, dark);
		setFunction(canvas, a, b, dark);
	}
}

/** Recorrido en zigzag de dos columnas, de derecha a izquierda, salteando la columna de sincronismo. */
function drawCodewords(canvas: Canvas, codewords: readonly number[]): void {
	const { size } = canvas;
	let index = 0;

	for (let right = size - 1; right >= 1; right -= 2) {
		if (right === 6) right = 5;
		for (let vertical = 0; vertical < size; vertical++) {
			for (let j = 0; j < 2; j++) {
				const col = right - j;
				const upward = ((right + 1) & 2) === 0;
				const row = upward ? size - 1 - vertical : vertical;

				if (!canvas.reserved[row][col] && index < codewords.length * 8) {
					canvas.modules[row][col] = ((codewords[index >>> 3] >>> (7 - (index & 7))) & 1) !== 0;
					index++;
				}
			}
		}
	}
}

function applyMask(canvas: Canvas, mask: number): void {
	const test = MASKS[mask];
	for (let row = 0; row < canvas.size; row++) {
		for (let col = 0; col < canvas.size; col++) {
			if (!canvas.reserved[row][col] && test(row, col)) canvas.modules[row][col] = !canvas.modules[row][col];
		}
	}
}

/** Penalizaciones N1..N4 del estándar. */
const PENALTY = { run: 3, block: 3, finder: 40, balance: 10 };

/** Regla 1: tiras de 5 o más módulos del mismo color. */
function penalizeRuns(line: readonly boolean[]): number {
	let penalty = 0;
	let runLength = 1;

	for (let i = 1; i <= line.length; i++) {
		if (i < line.length && line[i] === line[i - 1]) {
			runLength++;
			continue;
		}
		if (runLength >= 5) penalty += PENALTY.run + (runLength - 5);
		runLength = 1;
	}
	return penalty;
}

/** El 1:1:3:1:1 de la regla 3, oscuro-claro-oscuro×3-claro-oscuro. */
const FINDER_PATTERN = [true, false, true, true, true, false, true];

/**
 * Regla 3: falsos patrones de búsqueda. Cuenta un 1:1:3:1:1 cuando tiene cuatro módulos claros de
 * alguno de los dos lados, y también cuando toca el borde del símbolo: ahí lo que sigue es la zona
 * de silencio, que es clara, y un lector se confunde igual que en el medio del código.
 */
function penalizeFinderPatterns(line: readonly boolean[]): number {
	const size = line.length;
	let penalty = 0;

	for (let i = 0; i + FINDER_PATTERN.length <= size; i++) {
		if (!FINDER_PATTERN.every((value, offset) => line[i + offset] === value)) continue;

		const after = i + FINDER_PATTERN.length;
		const clearBefore = line.slice(Math.max(i - 4, 0), i).every((value) => !value);
		const clearAfter = line.slice(after, after + 4).every((value) => !value);
		if (clearBefore || clearAfter) penalty += PENALTY.finder;
	}
	return penalty;
}

/** Reglas 1 y 3 sobre una línea (fila o columna). */
function penalizeLine(line: readonly boolean[]): number {
	return penalizeRuns(line) + penalizeFinderPatterns(line);
}

function penaltyScore(canvas: Canvas): number {
	const { size, modules } = canvas;
	let penalty = 0;

	for (let i = 0; i < size; i++) {
		penalty += penalizeLine(modules[i]);
		penalty += penalizeLine(modules.map((row) => row[i]));
	}

	// Regla 2: bloques de 2×2 del mismo color.
	for (let row = 0; row < size - 1; row++) {
		for (let col = 0; col < size - 1; col++) {
			const value = modules[row][col];
			if (value === modules[row][col + 1] && value === modules[row + 1][col] && value === modules[row + 1][col + 1]) {
				penalty += PENALTY.block;
			}
		}
	}

	// Regla 4: desvío de la proporción de módulos oscuros respecto del 50 %, en tramos del 5 %.
	const dark = modules.reduce((acc, row) => acc + row.filter(Boolean).length, 0);
	const total = size * size;
	const deviation = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;

	return penalty + deviation * PENALTY.balance;
}

/**
 * Codifica `text` y devuelve la matriz de módulos (`true` = oscuro), **sin** zona de silencio: la
 * agrega quien renderiza, que es donde se sabe cuánto margen hay.
 */
export function encodeQr(text: string): boolean[][] {
	const bytes = new TextEncoder().encode(text);
	const version = pickVersion(bytes.length);
	const codewords = addEccAndInterleave(buildDataCodewords(bytes, version), version);

	const base = createCanvas(version);
	drawFunctionPatterns(base, version);
	drawCodewords(base, codewords);

	// Se prueban las ocho máscaras y gana la de menor penalización, como manda el estándar: es lo
	// que evita que queden zonas uniformes que confunden al lector.
	let best: boolean[][] = base.modules;
	let bestPenalty = Number.POSITIVE_INFINITY;

	for (let mask = 0; mask < MASKS.length; mask++) {
		const candidate: Canvas = {
			size: base.size,
			modules: base.modules.map((row) => [...row]),
			reserved: base.reserved,
		};
		applyMask(candidate, mask);
		drawFormatBits(candidate, mask);

		const penalty = penaltyScore(candidate);
		if (penalty < bestPenalty) {
			bestPenalty = penalty;
			best = candidate.modules;
		}
	}

	return best;
}
