import { useCallback, useEffect, useState } from "react";
import { router } from "@common/utils/router.js";
import { contentAPI, type Article, type LearningPath } from "../utils/content-api";

const PAGE_SIZE = 30;

export function ArticlesPage() {
	const [articles, setArticles] = useState<Article[]>([]);
	const [paths, setPaths] = useState<LearningPath[]>([]);
	const [loading, setLoading] = useState(true);
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedPathSlug, setSelectedPathSlug] = useState<string>("");
	const [page, setPage] = useState(1);
	const [total, setTotal] = useState(0);

	useEffect(() => {
		contentAPI.listPaths({ public: true, listed: true }).then(setPaths);
	}, []);

	useEffect(() => {
		setPage(1);
	}, [searchQuery, selectedPathSlug]);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		contentAPI
			.listArticles({
				listed: true,
				pathSlug: selectedPathSlug || undefined,
				q: searchQuery || undefined,
				limit: PAGE_SIZE,
				start: (page - 1) * PAGE_SIZE,
			})
			.then((r) => {
				if (cancelled) return;
				setArticles(r.articles);
				setTotal(r.total);
				setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [searchQuery, selectedPathSlug, page]);

	const searchRef = useCallback((el: HTMLElement | null) => {
		if (!el) return;
		el.addEventListener("adcInput", (e: Event) => {
			setSearchQuery((e as CustomEvent<string>).detail ?? "");
		});
	}, []);

	const paginationRef = useCallback((el: HTMLElement | null) => {
		if (!el) return;
		el.addEventListener("adcPageChange", (e: Event) => {
			setPage((e as CustomEvent<number>).detail);
		});
	}, []);

	const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

	const pathColorClasses: Record<string, string> = {
		red: "bg-red-200 text-red-700",
		orange: "bg-orange-200 text-orange-700",
		yellow: "bg-yellow-200 text-yellow-700",
		green: "bg-green-200 text-green-700",
		teal: "bg-teal-200 text-teal-700",
		blue: "bg-blue-200 text-blue-700",
		purple: "bg-purple-200 text-purple-700",
		pink: "bg-pink-200 text-pink-700",
	};

	return (
		<div className="px-8">
			<h1 className="text-3xl font-heading mb-4">Artículos</h1>

			<div className="flex gap-2 items-center">
				<adc-search-input ref={searchRef} value={searchQuery} placeholder="Buscar..." class="max-w-70" />
			</div>

			{paths.length > 0 && (
				<div className="flex flex-wrap gap-2 mt-4">
					<p className="text-sm font-medium">Filtros:</p>
					{paths.map((path) => {
						const colorClass = pathColorClasses[path.color] || "bg-gray-200 text-gray-700";
						const isSelected = selectedPathSlug === path.slug;

						return (
							<button
								key={path.slug}
								type="button"
								onClick={() => setSelectedPathSlug(isSelected ? "" : path.slug)}
								className={`px-2 py-1 rounded-xl text-sm flex items-center transition-all ${colorClass} ${
									isSelected ? "ring-2 ring-offset-2 ring-black" : ""
								}`}
							>
								{path.title}
							</button>
						);
					})}
				</div>
			)}

			{loading ? (
				<div className="text-center py-8">
					<p>Cargando artículos...</p>
				</div>
			) : articles.length > 0 ? (
				<>
					<div className="mt-4 grid gap-x-4 gap-y-16 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
						{articles.map((article) => (
							<adc-content-card
								key={article.slug}
								title={article.title}
								banner-url={article.image?.url}
								banner-alt={article.image?.alt}
								href={`/articles/${article.slug}`}
								onClick={(e: React.MouseEvent) => {
									e.preventDefault();
									router.navigate(`/articles/${article.slug}`);
								}}
								compact
							/>
						))}
					</div>
					{totalPages > 1 && (
						<div className="flex justify-center mt-8">
							<adc-pagination ref={paginationRef} currentPage={page} totalPages={totalPages} />
						</div>
					)}
				</>
			) : (
				<div className="text-center bg-surface rounded-xxl p-8 shadow-cozy mt-4">
					<p className="text-text">No hay artículos.</p>
				</div>
			)}
		</div>
	);
}
