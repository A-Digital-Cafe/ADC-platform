import { ACTION_FLAGS } from "@common/types/Actions.ts";

/**
 * Action bitfield values (columns of the permission matrix). Los bits salen de
 * `ACTION_FLAGS` para que la matriz no pueda quedar desfasada del enum de acciones.
 */
export const ACTIONS = [
	{ key: "read", value: ACTION_FLAGS.flags.read, label: "permissions.read" },
	{ key: "write", value: ACTION_FLAGS.flags.write, label: "permissions.write" },
	{ key: "update", value: ACTION_FLAGS.flags.update, label: "permissions.update" },
	{ key: "delete", value: ACTION_FLAGS.flags.delete, label: "permissions.delete" },
	{ key: "execute", value: ACTION_FLAGS.flags.execute, label: "permissions.execute" },
] as const;

/** Máscara de "todas las acciones": la usan el toggle de fila y el header de la matriz. */
export const ALL_ACTIONS = ACTION_FLAGS.all;
