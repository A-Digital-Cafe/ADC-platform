/**
 * Mapa de banderas de bit **atómicas** (una potencia de 2 por clave) con codificación,
 * decodificación y máscara total.
 *
 * Los alias compuestos de los enums de la plataforma (`CRUDXAction.CRUD = 15`, `ModulesScopes.ALL`)
 * se rechazan a propósito: mezclados con las atómicas rompen `decode` (una clave compuesta matchea
 * siempre). Construir sobre el subconjunto atómico y comparar el alias contra `all`.
 */
export default class BitFlags<T extends Record<string, number>> {
	readonly flags: T;
	/** OR de todas las banderas: la máscara "all on". */
	readonly all: number;

	constructor(flags: T) {
		let all = 0;
		for (const key in flags) {
			const value = flags[key];
			if (!isPowerOfTwo(value)) {
				throw new Error(`BitFlags: el valor de '${key}' (${value}) no es potencia de 2`);
			}
			// Dos claves con el mismo bit hacen que `decode` devuelva las dos siempre, sin fallar.
			if ((all & value) !== 0) {
				throw new Error(`BitFlags: el bit de '${key}' (${value}) ya está tomado por otra clave`);
			}
			all |= value;
		}
		this.flags = flags;
		this.all = all;
	}

	/** Codifica un conjunto de claves a su máscara. */
	encode(keys: readonly (keyof T)[]): number {
		let mask = 0;
		for (const key of keys) mask |= this.flags[key] ?? 0;
		return mask;
	}

	/** Decodifica una máscara a las claves que tiene activas. */
	decode(value: number): (keyof T)[] {
		return (Object.keys(this.flags) as (keyof T)[]).filter((key) => (value & this.flags[key]) !== 0);
	}

	/** `true` si la máscara tiene activa esa bandera. */
	has(value: number, key: keyof T): boolean {
		return (value & this.flags[key]) !== 0;
	}
}

function isPowerOfTwo(n: number): boolean {
	return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
}
