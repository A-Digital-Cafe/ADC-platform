/**
 * Resolución unificada de avatar de usuario. Fuente única de verdad usada por:
 * - SessionManagerService (login / /api/auth/session)
 * - content-service (articleResourceCtx)
 * - ProjectManagerService (issueResourceCtx)
 * - IdentityManagerService (endpoint público de avatar)
 *
 * Soporta selección explícita del usuario vía `metadata.avatarSource`:
 *   - `"default"`           → auto-avatar determinista servido por la plataforma
 *   - `"custom"`            → usa `metadata.customAvatar.attachmentId` (servido por
 *                             `/api/identity/users/:id/avatar/raw` que redirige a S3 presigned)
 *   - `"none"`              → sin avatar (fallback al auto-avatar en cliente)
 *
 * Si no hay selección explícita, prioridad legacy:
 *   1. `user.avatar` (columna explícita)
 *   2. `metadata.avatar` (string legacy)
 *   3. `metadata.customAvatar` si existe
 *
 * Devuelve SIEMPRE una URL propia: la foto de una cuenta OAuth se ingiere en el alta
 * (`IdentityManager.ingestProviderAvatar`) y se guarda como adjunto nuestro.
 */

interface UserAvatarSource {
	id?: string;
	username?: string;
	avatar?: string | null;
	metadata?: Record<string, unknown> | null;
}

interface CustomAvatarRef {
	attachmentId?: string;
}

function getCustomAvatarUrl(userId: string | undefined, ref: CustomAvatarRef | undefined | null): string | undefined {
	if (!userId || !ref?.attachmentId) return undefined;
	return `/api/identity/users/${encodeURIComponent(userId)}/avatar/raw`;
}

function getDefaultAvatarUrl(user: UserAvatarSource): string {
	return buildDefaultAvatarUrl(user.id || user.username || "default");
}

/**
 * Una URL de avatar absoluta apunta a un tercero: las propias son siempre relativas
 * (`/avatars/…`, `/api/identity/…`). Servirla le entrega al CDN de turno la IP de cada visitante
 * y la página que estaba mirando, así que se ignora y la cuenta cae al auto-avatar. Es la última
 * defensa: las cuentas viejas que todavía la tengan guardada las limpia el backfill de Identity.
 */
export const REMOTE_AVATAR_URL_PATTERN = "^https?://";
const REMOTE_AVATAR_URL_REGEX = new RegExp(REMOTE_AVATAR_URL_PATTERN, "i");

export function isRemoteAvatarUrl(url: string): boolean {
	return REMOTE_AVATAR_URL_REGEX.test(url);
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
	}

	if (user.avatar && !isRemoteAvatarUrl(user.avatar)) return user.avatar;
	const metaAvatar = metadata?.avatar;
	if (typeof metaAvatar === "string" && metaAvatar && !isRemoteAvatarUrl(metaAvatar)) return metaAvatar;
	const customUrl = getCustomAvatarUrl(user.id, metadata?.customAvatar);
	if (customUrl) return customUrl;
	return getDefaultAvatarUrl(user);
}

/** Avatares por defecto en `common/public/avatars`, que se copia a todas las apps. */
const DEFAULT_AVATARS = ["amarillo", "azul", "celeste", "morado", "naranja", "rojo", "rosa", "verde"] as const;

/**
 * @public URL del auto-avatar determinista para una semilla.
 *
 * Archivos estáticos propios, same-origin: enlazar un generador externo le contaba a un tercero
 * qué IDs de usuario mira cada visitante, en casi todas las pantallas y sin base legal ni aviso.
 * El hash sólo reparte colores, así que no necesita ser criptográfico — pero sí dar lo mismo en
 * servidor y en navegador, porque los dos construyen esta URL.
 */
export function buildDefaultAvatarUrl(seed: string): string {
	let hash = 0;
	for (let i = 0; i < seed.length; i++) hash = (hash * 31 + (seed.codePointAt(i) ?? 0)) >>> 0;
	return `/avatars/def-avatar-${DEFAULT_AVATARS[hash % DEFAULT_AVATARS.length]}.svg`;
}
