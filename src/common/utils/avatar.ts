/**
 * Resolución unificada de avatar de usuario. Fuente única de verdad usada por:
 * - SessionManagerService (login / /api/auth/session)
 * - content-service (articleResourceCtx)
 * - ProjectManagerService (issueResourceCtx)
 * - IdentityManagerService (endpoint público de avatar)
 *
 * Orden de prioridad:
 *   1. avatar explícito (perfil propio o columna users.avatar)
 *   2. metadata.avatar (custom upload)
 *   3. primer linkedAccount activo con providerAvatar
 */

export interface UserAvatarSource {
	avatar?: string | null;
	metadata?: Record<string, unknown> | null;
	linkedAccounts?: Array<{ status?: string; providerAvatar?: string }> | null;
}

export function resolveUserAvatar(user: UserAvatarSource | null | undefined): string | undefined {
	if (!user) return undefined;
	if (user.avatar) return user.avatar;
	const metaAvatar = user.metadata?.avatar;
	if (typeof metaAvatar === "string" && metaAvatar) return metaAvatar;
	const linked = user.linkedAccounts?.find((a) => a?.status === "linked" && a.providerAvatar)?.providerAvatar;
	return linked || undefined;
}

/** Construye la URL de DiceBear como avatar procedural determinista. */
export function buildDicebearAvatar(seed: string): string {
	return `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(seed)}&backgroundColor=b6e3f4,c0aede,d1d4f9`;
}
