/**
 * Resolución unificada de avatar de usuario. Fuente única de verdad usada por:
 * - SessionManagerService (login / /api/auth/session)
 * - content-service (articleResourceCtx)
 * - ProjectManagerService (issueResourceCtx)
 * - IdentityManagerService (endpoint público de avatar)
 *
 * Soporta selección explícita del usuario vía `metadata.avatarSource`:
 *   - `"default"`           → auto-avatar determinista DiceBear generado en backend
 *   - `"custom"`            → usa `metadata.customAvatar.attachmentId` (servido por
 *                             `/api/identity/users/:id/avatar/raw` que redirige a S3 presigned)
 *   - `"linked:<provider>"` → usa el `providerAvatar` del `LinkedAccount` indicado
 *   - `"none"`              → sin avatar (fallback a DiceBear en cliente)
 *
 * Si no hay selección explícita, prioridad legacy:
 *   1. `user.avatar` (columna explícita)
 *   2. `metadata.avatar` (string legacy)
 *   3. `metadata.customAvatar` si existe
 *   4. primer linkedAccount activo con providerAvatar
 */

interface UserAvatarSource {
	id?: string;
	username?: string;
	avatar?: string | null;
	metadata?: Record<string, unknown> | null;
	linkedAccounts?: Array<{ provider?: string; status?: string; providerAvatar?: string }> | null;
}

interface CustomAvatarRef {
	attachmentId?: string;
}

function getCustomAvatarUrl(userId: string | undefined, ref: CustomAvatarRef | undefined | null): string | undefined {
	if (!userId || !ref?.attachmentId) return undefined;
	return `/api/identity/users/${encodeURIComponent(userId)}/avatar/raw`;
}

function getDefaultAvatarUrl(user: UserAvatarSource): string {
	return buildDicebearAvatar(user.id || user.username || "default");
}

export function resolveUserAvatar(user: UserAvatarSource | null | undefined): string | undefined {
	if (!user) return undefined;

	const metadata = user.metadata as
		| {
				avatar?: unknown;
				avatarSource?: unknown;
				customAvatar?: CustomAvatarRef | null;
		  }
		| undefined
		| null;

	const source = typeof metadata?.avatarSource === "string" ? metadata.avatarSource : undefined;

	if (source === "none") return undefined;
	if (source === "default") return getDefaultAvatarUrl(user);
	if (source === "custom") {
		const url = getCustomAvatarUrl(user.id, metadata?.customAvatar);
		if (url) return url;
	} else if (source?.startsWith("linked:")) {
		const provider = source.slice("linked:".length);
		const acc = user.linkedAccounts?.find((a) => a?.provider === provider && a.status === "linked" && a.providerAvatar);
		if (acc?.providerAvatar) return acc.providerAvatar;
	}

	if (user.avatar) return user.avatar;
	const metaAvatar = metadata?.avatar;
	if (typeof metaAvatar === "string" && metaAvatar) return metaAvatar;
	const customUrl = getCustomAvatarUrl(user.id, metadata?.customAvatar);
	if (customUrl) return customUrl;
	const linked = user.linkedAccounts?.find((a) => a?.status === "linked" && a.providerAvatar)?.providerAvatar;
	return linked || getDefaultAvatarUrl(user);
}

/** @public Construye la URL de DiceBear como avatar procedural determinista. */
export function buildDicebearAvatar(seed: string): string {
	return `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(seed)}&backgroundColor=b6e3f4,c0aede,d1d4f9`;
}
