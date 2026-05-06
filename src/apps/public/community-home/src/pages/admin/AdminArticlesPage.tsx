import { useCallback, useEffect, useState } from "react";
import { router } from "@common/utils/router.js";
import { contentAPI, type Article } from "../../utils/content-api";
import { AdminGate } from "../../components/admin/AdminGate";

const PAGE_SIZE = 30;

function status(a: Article) {
	if (a.listed) return { text: "Publicado", cls: "text-tsuccess" };
	if (!a.description) return { text: "Para revisar", cls: "text-warn" };
	return { text: "Preparado", cls: "text-tinfo" };
}

function ArticlesList({ authorId }: { readonly authorId?: string }) {
	const [articles, setArticles] = useState<Article[] | null>(null);
	const [searchQuery, setSearchQuery] = useState("");
	const [page, setPage] = useState(1);
	const [total, setTotal] = useState(0);
	const heading = authorId ? "Mis artículos" : "Artículos";

	useEffect(() => {
		setPage(1);
	}, [searchQuery, authorId]);

	useEffect(() => {
		let cancelled = false;
		setArticles(null);
		contentAPI
			.listArticles({
				authorId: authorId || undefined,
				q: searchQuery || undefined,
				limit: PAGE_SIZE,
				start: (page - 1) * PAGE_SIZE,
			})
			.then((r) => {
				if (cancelled) return;
				setArticles(r.articles);
				setTotal(r.total);
			});
		return () => {
			cancelled = true;
		};
	}, [authorId, searchQuery, page]);

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

	return (
		<div className="p-8">
			<h1>{heading}</h1>
			<div className="my-4 flex flex-wrap items-center gap-3">
				<button
					type="button"
					onClick={() => router.navigate("/admin/publish")}
					className="px-4 py-2 bg-primary text-tprimary rounded-xxl"
				>
					+ Nuevo artículo
				</button>
				<adc-search-input ref={searchRef} value={searchQuery} placeholder="Buscar..." class="max-w-70" />
			</div>
			{articles === null ? (
				<p className="text-muted">Cargando...</p>
			) : articles.length === 0 ? (
				<p className="text-muted">No hay artículos.</p>
			) : (
				<>
					<ul className="flex flex-col gap-2">
						{articles.map((a) => {
							const s = status(a);
							return (
								<li key={a.slug} className="p-3 bg-surface rounded-xxl shadow-cozy flex items-center justify-between gap-2">
									<a
										href={`/admin/articles/${a.slug}`}
										onClick={(e) => {
											e.preventDefault();
											router.navigate(`/admin/articles/${a.slug}`);
										}}
										className="underline text-text"
									>
										{a.title}
									</a>
									<span className={`text-sm font-medium ${s.cls}`}>{s.text}</span>
								</li>
							);
						})}
					</ul>
					{totalPages > 1 && (
						<div className="flex justify-center mt-6">
							<adc-pagination ref={paginationRef} currentPage={page} totalPages={totalPages} />
						</div>
					)}
				</>
			)}
		</div>
	);
}

export function AdminArticlesPage() {
	return <AdminGate>{(session, isReviewer) => <ArticlesList authorId={isReviewer ? undefined : session.user?.id} />}</AdminGate>;
}
