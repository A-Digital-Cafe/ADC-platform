import { useEffect, useRef, useState } from "react";
import { router } from "@common/utils/router.js";
import { getSession, type SessionData } from "@ui-library/utils/session";
import { canRate } from "../utils/permissions";
import { contentAPI, type Article, type LearningPath } from "../utils/content-api";
import { socialApi, type RatingStats } from "../utils/social-api";
import { useArticleComments } from "../hooks/useArticleComments";
import { ArticleHeader } from "../components/ArticleHeader";
import { ArticleCommentsBlock } from "../components/ArticleCommentsBlock";

export function ArticlePage({ slug }: { readonly slug: string }) {
	const [article, setArticle] = useState<Article | null>(null);
	const [fromPath, setFromPath] = useState<LearningPath | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [session, setSession] = useState<SessionData>({ authenticated: false });
	const [rating, setRating] = useState<RatingStats>({ average: 0, count: 0, myRating: null });
	const [ratingPending, setRatingPending] = useState(false);

	const commentsState = useArticleComments(slug);

	const urlParams = new URLSearchParams(globalThis.location?.search);
	const fromPathSlug = urlParams.get("fromPath");
	const shareUrl = typeof globalThis !== "undefined" ? globalThis.location?.href : "";

	const breadcrumbRef = useRef<HTMLElement & { adcBack?: unknown }>(null);

	useEffect(() => {
		void loadArticle();
		void commentsState.loadInitial();
		void socialApi.getRating(slug).then(setRating);
		void getSession().then(setSession);
	}, [slug]);

	useEffect(() => {
		const el = breadcrumbRef.current;
		if (!el) return;
		const handler = () => {
			if (fromPathSlug) router.navigate(`/paths/${fromPathSlug}`);
			else router.navigate("/articles");
		};
		el.addEventListener("adcBack", handler);
		return () => el.removeEventListener("adcBack", handler);
	}, [fromPathSlug]);

	async function loadArticle() {
		setLoading(true);
		setError(null);
		try {
			const articleData = await contentAPI.getArticle(slug);
			if (!articleData) {
				setError("Artículo no encontrado");
				return;
			}
			setArticle(articleData);
			const pathSlug = fromPathSlug || articleData.pathSlug;
			if (pathSlug) {
				const pathData = await contentAPI.getPath(pathSlug);
				if (pathData) setFromPath(pathData);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Error desconocido");
		} finally {
			setLoading(false);
		}
	}

	async function handleRate(value: number) {
		setRatingPending(true);
		try {
			const ok = await socialApi.rate(slug, value);
			if (ok) setRating(await socialApi.getRating(slug));
		} finally {
			setRatingPending(false);
		}
	}

	if (loading) {
		return (
			<div style={{ padding: "2rem" }}>
				<div className="text-center py-8">
					<p>Cargando artículo...</p>
				</div>
			</div>
		);
	}

	if (error || !article) {
		return (
			<div style={{ padding: "2rem" }}>
				<div className="text-center py-8">
					<p className="text-red-600">{error || "Artículo no encontrado"}</p>
					<button
						type="button"
						onClick={() => router.navigate("/articles")}
						className="mt-4 px-4 py-2 bg-primary text-tprimary rounded-xxl"
					>
						Volver a artículos
					</button>
				</div>
			</div>
		);
	}

	const userCanRate = session.authenticated && canRate(session.user?.perms ?? []);

	const breadcrumbItems = JSON.stringify(
		fromPathSlug
			? [
					{ label: "Learning Paths", href: "/paths" },
					{ label: fromPath?.title || article.pathSlug || "Path", href: `/paths/${fromPathSlug}` },
					{ label: article.title },
				]
			: [{ label: "Artículos", href: "/articles" }, { label: article.title }]
	);

	return (
		<div style={{ padding: "2rem" }}>
			<adc-top-breadcrumb ref={breadcrumbRef} items={breadcrumbItems} back-label="Volver" />
			<ArticleHeader
				article={article}
				fromPath={fromPath}
				fromPathSlug={fromPathSlug}
				session={session}
				rating={rating}
				ratingPending={ratingPending}
				canRate={userCanRate}
				onRate={(v) => void handleRate(v)}
				shareUrl={shareUrl}
			/>
			{article.videoUrl && (
				<div style={{ margin: "1rem 0" }}>
					<adc-youtube-facade src={article.videoUrl} title={article.title} />
				</div>
			)}
			{article.blocks && article.blocks.length > 0 && <adc-blocks-renderer blocks={article.blocks} />}
			<ArticleCommentsBlock session={session} articleAuthorId={article.authorId} state={commentsState} />
		</div>
	);
}
