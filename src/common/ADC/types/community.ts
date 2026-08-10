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
