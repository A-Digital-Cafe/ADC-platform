import { useEffect, useRef, useState } from "react";
import { router } from "@common/utils/router.js";
import { getSession } from "@ui-library/utils/session";
import { canEditContent } from "../utils/permissions";
import { contentAPI, type LearningPath, type Article, type PathItemLevel } from "../utils/content-api";

type Level = PathItemLevel;
type ItemElement = Article | LearningPath;
// Item poblado desde el backend
type PopulatedItem = { slug: string; type: "article" | "path"; level?: Level; element: ItemElement };
type ExpandedItem = { level: Level; element: ItemElement; type: "article" | "path"; row: number };

const LEVEL_TITLES: Record<Level, string> = {
	critico: "Critico",
	importante: "Importante",
	opcional: "Opcional",
};

// Colores para artículos
const ARTICLE_LEVEL_COLORS: Record<Level, string> = {
	critico: "bg-amber-400 text-black",
	importante: "bg-amber-200 text-black",
	opcional: "bg-amber-100 text-black",
};

// Colores para paths
const PATH_LEVEL_COLORS: Record<Level, string> = {
	critico: "bg-violet-500 text-white",
	importante: "bg-violet-300 text-black",
	opcional: "bg-violet-100 text-black",
};

const getLevelColor = (type: "article" | "path", level: Level) => (type === "path" ? PATH_LEVEL_COLORS[level] : ARTICLE_LEVEL_COLORS[level]);

const ALL_LEVELS: Level[] = ["critico", "importante", "opcional"];

function handleBack() {
	router.navigate("/paths");
}

export function PathPage({ slug }: { readonly slug: string }) {
	const [path, setPath] = useState<LearningPath | null>(null);
	const [items, setItems] = useState<ExpandedItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [canEdit, setCanEdit] = useState(false);
	const breadcrumbRef = useRef<HTMLElement>(null);

	useEffect(() => {
		loadPath();
	}, [slug]);

	useEffect(() => {
		getSession().then((s) => setCanEdit(canEditContent(s.user?.perms)));
	}, []);

	useEffect(() => {
		const el = breadcrumbRef.current;
		if (!el) return;
		const handler = () => handleBack();
		el.addEventListener("adcBack", handler);
		return () => el.removeEventListener("adcBack", handler);
	}, []);

	async function loadPath() {
		setLoading(true);
		setError(null);

		try {
			const pathData = await contentAPI.getPath(slug);
			if (!pathData) {
				setError("Ruta de aprendizaje no encontrada");
				return;
			}
			setPath(pathData);

			const expandedItems: ExpandedItem[] = (pathData.items as PopulatedItem[])
				.filter((item) => item.element)
				.map((item, idx) => ({
					level: item.level || "opcional",
					element: item.element,
					type: item.type,
					row: idx + 2, // Row 1 es para headers
				}));

			setItems(expandedItems);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Error desconocido");
		} finally {
			setLoading(false);
		}
	}

	// Niveles disponibles en este path
	const availableLevels = ALL_LEVELS.filter((level) => items.some((item) => item.level === level));

	// Columna para cada nivel
	const levelCol: Record<Level, number> = {
		critico: availableLevels.indexOf("critico") + 1 || 1,
		importante: availableLevels.indexOf("importante") + 1 || 1,
		opcional: availableLevels.indexOf("opcional") + 1 || 1,
	};

	function getColStartClass(level: Level): string {
		const col = levelCol[level];
		if (col === 1) return "md:col-start-1";
		if (col === 2) return "md:col-start-2";
		if (col === 3) return "md:col-start-3";
		return "";
	}

	function getGridColsClass(): string {
		if (availableLevels.length === 1) return "md:grid-cols-1";
		if (availableLevels.length === 2) return "md:grid-cols-2";
		return "md:grid-cols-3";
	}

	// URL para compartir
	const shareUrl = globalThis.location?.href ?? "";

	if (loading) {
		return (
			<div style={{ padding: "2rem" }}>
				<div className="text-center py-8">
					<p>Cargando ruta de aprendizaje...</p>
				</div>
			</div>
		);
	}

	if (error || !path) {
		return (
			<div style={{ padding: "2rem" }}>
				<div className="text-center py-8">
					<p className="text-tdanger">{error || "Ruta no encontrada"}</p>
					<button type="button" onClick={handleBack} className="mt-4 px-4 py-2 bg-primary text-tprimary rounded-xxl">
						Volver a paths
					</button>
				</div>
			</div>
		);
	}

	return (
		<div style={{ padding: "2rem" }}>
			<adc-top-breadcrumb
				ref={breadcrumbRef}
				items={JSON.stringify([{ label: "Learning Paths", href: "/paths" }, { label: path.title }])}
				back-label="Volver a Paths"
			/>

			{/* Título y share buttons */}
			<div className="flex flex-col gap-2 mb-4 md:flex-row md:items-center">
				<h1>{path.title}</h1>
				<div className="flex items-center gap-2">
					<adc-share-buttons title={path.title} description={path.description || ""} url={shareUrl} />
					{canEdit && (
						<button
							type="button"
							title="Editar path"
							aria-label="Editar path"
							onClick={() => router.navigate(`/admin/paths?slug=${path.slug}`)}
							className="ml-2 p-3 bg-surface cursor-pointer text-button rounded-full hover:brightness-105 min-h-11 min-w-11 flex items-center justify-center"
						>
							<adc-icon-edit />
						</button>
					)}
				</div>
			</div>

			{/* Banner */}
			{path.banner && (
				<img
					src={path.banner.url}
					alt={path.banner.alt || path.title}
					width={path.banner.width}
					height={path.banner.height}
					className="w-full max-h-96 object-cover rounded-xxl mb-4"
				/>
			)}

			{/* Descripcion */}
			<adc-text class="mb-4">{path.description}</adc-text>

			{/* Leyenda de niveles (solo mobile) */}
			{availableLevels.length > 1 && (
				<div className="flex flex-wrap gap-2 mb-4 md:hidden">
					{availableLevels.map((level) => (
						<span key={level} className={`px-2 py-1 rounded text-sm ${ARTICLE_LEVEL_COLORS[level]}`}>
							{LEVEL_TITLES[level]}
						</span>
					))}
				</div>
			)}

			{/* Grid de items */}
			<div className={`mt-4 flex flex-col gap-6 md:grid md:gap-y-8 ${getGridColsClass()}`}>
				{/* Headers (solo desktop, solo si hay mas de 1 nivel) */}
				{availableLevels.length > 1 &&
					availableLevels.map((level) => (
						<h2
							key={`header-${level}`}
							className={`text-center mb-2 px-4 hidden md:block ${getColStartClass(level)}`}
							style={{ gridRow: 1 }}
						>
							{LEVEL_TITLES[level]}
						</h2>
					))}

				{availableLevels.length === 1 && (
					<h2 className="text-center mb-2 px-4 hidden md:block md:col-start-1" style={{ gridRow: 1 }}>
						Ruta de aprendizaje
					</h2>
				)}

				{/* Items */}
				{items.map((item, idx) => {
					const article = item.element as Article;
					const subPath = item.element as LearningPath;

					return (
						<div
							key={`${item.type}:${item.element.slug}`}
							className={`relative flex flex-col items-stretch md:px-4 ${getColStartClass(item.level)}`}
							style={{ gridRow: item.row }}
						>
							{item.type === "article" ? (
								<a
									href={`/articles/${article.slug}?fromPath=${slug}`}
									onClick={(e) => {
										e.preventDefault();
										router.navigate(`/articles/${article.slug}?fromPath=${slug}`);
									}}
									className={`flex items-center gap-4 rounded-xxl shadow-cozy no-underline transition-transform p-4 hover:scale-105 hover:z-10 max-w-[80vw] mx-auto ${getLevelColor(
										"article",
										item.level
									)}`}
								>
									{article.image && (
										<img
											src={article.image.url}
											alt={article.image.alt || article.title}
											className="w-24 object-cover rounded-xxl shrink-0 aspect-4/3"
										/>
									)}
									<div className="flex flex-col">
										<h3 className="h3">{article.title}</h3>
									</div>
								</a>
							) : (
								<a
									href={`/paths/${subPath.slug}`}
									onClick={(e) => {
										e.preventDefault();
										router.navigate(`/paths/${subPath.slug}`);
									}}
									className={`flex flex-col gap-3 rounded-xxl shadow-cozy no-underline transition-transform p-4 hover:scale-105 hover:z-10 max-w-[80vw] mx-auto ${getLevelColor(
										"path",
										item.level
									)}`}
								>
									{subPath.banner && (
										<img
											src={subPath.banner.url}
											alt={subPath.banner.alt || subPath.title}
											className="w-full h-36 object-cover rounded-xl"
										/>
									)}
									<div className="flex flex-col gap-1">
										<h2 className="text-lg font-semibold">{subPath.title}</h2>
										<adc-text>{subPath.description}</adc-text>
									</div>
								</a>
							)}

							{/* Linea conectora (solo desktop) */}
							{items.slice(idx + 1).some((n) => n.level === item.level) && (
								<div className="absolute left-1/2 top-full w-px h-4 bg-accent hidden md:block" />
							)}
						</div>
					);
				})}
			</div>

			{items.length === 0 && (
				<div className="text-center bg-surface rounded-xxl p-8 shadow-cozy mt-4">
					<p className="text-text">Esta ruta de aprendizaje aun no tiene contenido.</p>
				</div>
			)}
		</div>
	);
}
