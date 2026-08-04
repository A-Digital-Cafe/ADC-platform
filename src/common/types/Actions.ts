// Action (bitfield) — Source of truth

/**
 * Acciones disponibles como bitfield.
 * Permite combinaciones: READ | WRITE = 3
 */
export const CRUDXAction = {
	NONE: 0,
	READ: 1, // 1
	WRITE: 2, // 2
	RW: 3, // 3
	UPDATE: 4, // 4
	DELETE: 8, // 8
	EXECUTE: 16, // 16
	CRUD: 15, // 15
	ALL: 31, // 31
} as const;

export type CRUDXAction = (typeof CRUDXAction)[keyof typeof CRUDXAction];
