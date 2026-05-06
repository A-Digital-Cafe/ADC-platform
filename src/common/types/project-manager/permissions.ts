export const PM_RESOURCE_NAME = "project-manager" as const;

/**
 * Scopes del recurso `project-manager` (bitfield).
 */
export const PMScopes = {
	NONE: 0,
	PROJECTS: 1, // 1
	ISSUES: 1 << 1, // 2
	SPRINTS: 1 << 2, // 4
	MILESTONES: 1 << 3, // 8
	CUSTOM_FIELDS: 1 << 5, // 32
	ATTACHMENTS: 1 << 6, // 64
	SETTINGS: 1 << 7, // 128
	STATS: 1 << 8, // 256
	COMMENTS: 1 << 9, // 512
	SELF: 1 << 15, // 32768
	ALL: 1 | (1 << 1) | (1 << 2) | (1 << 3) | (1 << 5) | (1 << 6) | (1 << 7) | (1 << 8) | (1 << 9), // 1007
} as const;

export type PMScopeValue = (typeof PMScopes)[keyof typeof PMScopes];
