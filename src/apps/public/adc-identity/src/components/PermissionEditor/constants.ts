/**
 * Action bitfield values (columns of the permission matrix)
 */
export const ACTIONS = [
	{ key: "read", value: 1, label: "permissions.read" },
	{ key: "write", value: 2, label: "permissions.write" },
	{ key: "update", value: 4, label: "permissions.update" },
	{ key: "delete", value: 8, label: "permissions.delete" },
	{ key: "execute", value: 16, label: "permissions.execute" },
] as const;
