import BitFlags from "@common/utils/bitflags.ts";

// Action (bitfield) — Source of truth

/**
 * Acciones disponibles como bitfield.
 * Permite combinaciones: READ | WRITE = 3
 *
 * Los alias compuestos (`RW`/`CRUD`/`ALL`) se escriben a mano en vez de derivarse de
 * {@link ACTION_FLAGS}: el valor literal es lo que le da a `P.IDENTITY.USERS.READ` el tipo
 * `"identity.2.1"` en vez de `` `identity.${number}.${number}` ``.
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

/**
 * Las acciones **atómicas** como banderas con nombre (codificables/decodificables).
 * `ACTION_FLAGS.all` es `CRUDXAction.ALL` (31) por construcción.
 */
export const ACTION_FLAGS = new BitFlags({
	read: CRUDXAction.READ,
	write: CRUDXAction.WRITE,
	update: CRUDXAction.UPDATE,
	delete: CRUDXAction.DELETE,
	execute: CRUDXAction.EXECUTE,
});
