import { router } from "@common/utils/router.js";
import { canEditContent } from "../utils/permissions";
import type { SessionData } from "@ui-library/utils/session";
import type { Article, LearningPath } from "../utils/content-api";
import type { RatingStats } from "../utils/social-api";
import { AUTHORS } from "../utils/constants";

const PATH_COLOR_CLASSES: Record<string, string> = {
	red: "bg-red-200 text-red-700",
	orange: "bg-orange-200 text-orange-700",
	yellow: "bg-yellow-200 text-yellow-700",
	green: "bg-green-200 text-green-700",
	teal: "bg-teal-200 text-teal-700",
	blue: "bg-blue-200 text-blue-700",
	purple: "bg-purple-200 text-purple-700",
	pink: "bg-pink-200 text-pink-700",
};

interface Props {
	article: Article;
	fromPath: LearningPath | null;
	fromPathSlug: string | null;
	session: SessionData;
	rating: RatingStats;
	ratingPending: boolean;
	canRate: boolean;
	onRate: (value: number) => void;
	shareUrl: string;
}

export function ArticleHeader({ article, fromPath, fromPathSlug, session, rating, ratingPending, canRate, onRate, shareUrl }: Props) {
	const author = article.authorId ? AUTHORS.get(article.authorId) : null;
	const pathColor = fromPath?.color || article.pathColor;
	const pathTitle = fromPath?.title || article.pathSlug;
	const colorClass = pathColor ? PATH_COLOR_CLASSES[pathColor] || "bg-gray-200 text-gray-700" : "";
	const linkSlug = fromPathSlug || article.pathSlug;

	return (
		<>
			<div className="flex flex-col gap-2 mb-4 md:flex-row md:items-center">
				<h1>{article.title}</h1>
				{author && <p style={{ color: "#666666" }}>por {author.name}</p>}
				<div className="flex items-center gap-2">
					<adc-share-buttons title={article.title} description={article.description || ""} url={shareUrl} />
					{canEditContent(session.user?.perms) && (
						<button
							type="button"
							title="Editar artículo"
							aria-label="Editar artículo"
							onClick={() => router.navigate(`/admin/articles/${article.slug}`)}
							className="ml-2 p-3 bg-surface cursor-pointer text-button rounded-full hover:brightness-105 min-h-11 min-w-11 flex items-center justify-center"
						>
							<adc-icon-edit />
						</button>
					)}
				</div>
			</div>
			<div className="flex flex-wrap items-center gap-2 mb-4">
				{pathTitle && (
					<a
						href={`/paths/${linkSlug}`}
						className={`px-3 py-1 rounded-xl text-sm no-underline ${colorClass}`}
						onClick={(e) => {
							e.preventDefault();
							router.navigate(`/paths/${linkSlug}`);
						}}
					>
						{pathTitle}
					</a>
				)}
				<adc-star-rating
					average={rating.average || null}
					count={rating.count || null}
					myRating={rating.myRating}
					canRate={canRate}
					pending={ratingPending}
					onadcRate={(ev: CustomEvent<number>) => onRate(ev.detail)}
				/>
			</div>
		</>
	);
}
