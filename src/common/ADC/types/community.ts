/**
 * Tipos para interacción social en Community (ratings, métricas).
 * Los comentarios ahora se almacenan vía `comments-utility` y se exponen como
 * el tipo unificado `Comment` de `@common/types/comments/Comment`.
 */

export interface Rating {
	articleSlug: string;
	userId: string;
	value: 1 | 2 | 3 | 4 | 5;
	createdAt?: string;
	updatedAt?: string;
}

export interface RatingStats {
	average: number;
	count: number;
	myRating: number | null;
}

/** @public */
export const RATING_MIN = 1;
/** @public */
export const RATING_MAX = 5;

/**
 * Comunidad aliada listada en la home de community. La curaduría es editorial: aparecer no implica
 * respaldo, y el orden lo mueve la propia comunidad con `/potenciar` desde el bot.
 * @public
 */
export interface CommunityAlly {
	/** Numérico y secuencial: es el que se tipea en `/potenciar {id}`. */
	id: number;
	name: string;
	description: string;
	inviteUrl: string;
	/** Servido por `/api/learning/allies/:id/logo/raw`; el binario vive en nuestro S3, no en el CDN de Discord. */
	hasLogo?: boolean;
	visible?: boolean;
	/** "Potencia total": boosts acumulados. */
	boostCount: number;
	/** ISO 8601. Ausente si nunca la potenciaron. */
	lastBoostAt?: string;
	createdAt?: string;
	updatedAt?: string;
}

/** @public Límites de los campos editables de una comunidad aliada. */
export const ALLY_LIMITS = {
	name: { min: 2, max: 80 },
	description: { min: 10, max: 400 },
	inviteUrl: { max: 200 },
} as const;

/** @public Página de la lista pública. 10 fijos: es el tamaño con el que se diseñó la sección. */
export const ALLY_PAGE_SIZE = 10;

/** @public Criterios de orden que acepta el listado público. */
export type AllySort = "power" | "recent";

/**
 * Hosts de invitación aceptados. La allowlist es el punto que impide que el listado se vuelva un
 * redirector abierto: sin ella, cualquier URL publicada en una card sale con el dominio de ADC detrás.
 * @public
 */
const INVITE_HOSTS: ReadonlyArray<{ host: string; prefix?: string }> = [
	{ host: "discord.gg" },
	{ host: "discord.com", prefix: "/invite/" },
	{ host: "www.discord.com", prefix: "/invite/" },
	{ host: "discordapp.com", prefix: "/invite/" },
];

/** @public Valida una URL de invitación de Discord (https + host de la allowlist + código no vacío). */
export function isValidDiscordInvite(raw: string): boolean {
	if (!raw || raw.length > ALLY_LIMITS.inviteUrl.max) return false;
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return false;
	}
	if (url.protocol !== "https:") return false;
	const match = INVITE_HOSTS.find((entry) => entry.host === url.hostname);
	if (!match) return false;
	const code = match.prefix ? url.pathname.slice(match.prefix.length) : url.pathname.slice(1);
	return url.pathname.startsWith(match.prefix ?? "/") && /^[a-zA-Z0-9-]{2,64}$/.test(code);
}
