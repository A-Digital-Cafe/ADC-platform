import "@ui-library/utils/react-jsx";
import { useState, useEffect } from "react";
import { contentAPI, type Article, type PathItemLevel } from "../../utils/content-api";

const LEVELS: PathItemLevel[] = ["critico", "importante", "opcional"];

/** MIME type usado para transferir artículos al arrastrarlos al editor de items. */
const DND_MIME = "application/x-adc-article";

export interface PathItem {
	slug: string;
	type: "article" | "path";
	level: PathItemLevel;
	title?: string;
}

interface Props {
	readonly items: PathItem[];
	readonly onChange: (items: PathItem[]) => void;
	readonly excludePathSlug?: string;
}

export function PathItemsEditor({ items, onChange, excludePathSlug }: Props) {
	const [q, setQ] = useState("");
	const [results, setResults] = useState<Article[]>([]);
	const [dragIndex, setDragIndex] = useState<number | null>(null);
	const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
	const [dropActive, setDropActive] = useState(false);

	useEffect(() => {
		const h = setTimeout(() => {
			contentAPI.listArticles({ q: q || undefined, limit: 20 }).then((r) => setResults(r.articles));
		}, 300);
		return () => clearTimeout(h);
	}, [q]);

	function addArticle(a: Article): boolean {
		if (items.some((it) => it.slug === a.slug && it.type === "article")) return false;
		onChange([...items, { slug: a.slug, type: "article", level: "importante", title: a.title }]);
		return true;
	}

	function removeAt(i: number) {
		onChange(items.filter((_, idx) => idx !== i));
	}

	function reorder(from: number, to: number) {
		if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return;
		const copy = items.slice();
		const [moved] = copy.splice(from, 1);
		copy.splice(to, 0, moved);
		onChange(copy);
	}

	function setLevel(i: number, level: PathItemLevel) {
		onChange(items.map((it, idx) => (idx === i ? { ...it, level } : it)));
	}

	function handleArticleDragStart(ev: React.DragEvent, a: Article) {
		ev.dataTransfer.effectAllowed = "copy";
		ev.dataTransfer.setData(DND_MIME, JSON.stringify({ slug: a.slug, title: a.title }));
		ev.dataTransfer.setData("text/plain", a.title);
	}

	function handleItemDragStart(ev: React.DragEvent, index: number) {
		ev.dataTransfer.effectAllowed = "move";
		ev.dataTransfer.setData("text/plain", String(index));
		setDragIndex(index);
	}

	function handleItemDragOver(ev: React.DragEvent, index: number) {
		if (dragIndex === null && !ev.dataTransfer.types.includes(DND_MIME)) return;
		ev.preventDefault();
		ev.dataTransfer.dropEffect = dragIndex !== null ? "move" : "copy";
		setDragOverIndex(index);
	}

	function handleItemDrop(ev: React.DragEvent, index: number) {
		ev.preventDefault();
		// Caso 1: soltaron un artículo nuevo desde el buscador.
		const raw = ev.dataTransfer.getData(DND_MIME);
		if (raw) {
			try {
				const { slug, title } = JSON.parse(raw) as { slug: string; title?: string };
				if (!items.some((it) => it.slug === slug && it.type === "article")) {
					const copy = items.slice();
					copy.splice(index, 0, { slug, type: "article", level: "importante", title });
					onChange(copy);
				}
			} catch {
				/* payload inválido */
			}
		} else if (dragIndex !== null) {
			reorder(dragIndex, index);
		}
		setDragIndex(null);
		setDragOverIndex(null);
	}

	function handleListDropEnd() {
		setDragIndex(null);
		setDragOverIndex(null);
		setDropActive(false);
	}

	function handleDropZoneDragOver(ev: React.DragEvent) {
		if (!ev.dataTransfer.types.includes(DND_MIME) && dragIndex === null) return;
		ev.preventDefault();
		ev.dataTransfer.dropEffect = dragIndex !== null ? "move" : "copy";
		setDropActive(true);
	}

	function handleDropZoneDrop(ev: React.DragEvent) {
		ev.preventDefault();
		const raw = ev.dataTransfer.getData(DND_MIME);
		if (raw) {
			try {
				const { slug, title } = JSON.parse(raw) as { slug: string; title?: string };
				if (!items.some((it) => it.slug === slug && it.type === "article")) {
					onChange([...items, { slug, type: "article", level: "importante", title }]);
				}
			} catch {
				/* payload inválido */
			}
		} else if (dragIndex !== null) {
			reorder(dragIndex, items.length - 1);
		}
		handleListDropEnd();
	}

	const filteredResults = results.filter((a) => (excludePathSlug ? a.slug !== excludePathSlug : true));

	return (
		<div className="flex flex-col gap-4">
			<div>
				<h3>Items del Path</h3>
				<ol
					className={`flex flex-col gap-2 min-h-16 rounded-xxl border-2 border-dashed p-2 transition-colors ${dropActive ? "border-accent bg-accent/10" : "border-transparent"}`}
					onDragOver={handleDropZoneDragOver}
					onDragLeave={() => setDropActive(false)}
					onDrop={handleDropZoneDrop}
					onDragEnd={handleListDropEnd}
				>
					{items.length === 0 && <li className="text-muted text-sm p-2">Arrastra artículos aquí para añadirlos.</li>}
					{items.map((it, i) => (
						<li
							key={`${it.type}:${it.slug}`}
							draggable
							onDragStart={(e) => handleItemDragStart(e, i)}
							onDragOver={(e) => handleItemDragOver(e, i)}
							onDrop={(e) => handleItemDrop(e, i)}
							onDragEnd={handleListDropEnd}
							className={`flex items-center gap-2 px-3 py-3 bg-surface rounded-xxl cursor-grab active:cursor-grabbing ${dragOverIndex === i ? "ring-2 ring-accent" : ""} ${dragIndex === i ? "opacity-50" : ""}`}
						>
							<span aria-hidden="true" className="text-muted select-none px-1">
								⋮⋮
							</span>
							<span className="flex-1 truncate">
								<strong>{it.title || it.slug}</strong> <small className="text-muted">({it.type})</small>
							</span>
							<select
								value={it.level}
								onChange={(e) => setLevel(i, e.target.value as PathItemLevel)}
								className="p-1 rounded-xxl border border-alt bg-background"
							>
								{LEVELS.map((lv) => (
									<option key={lv} value={lv}>
										{lv}
									</option>
								))}
							</select>
							<adc-button-rounded variant="danger" aria-label={`Quitar ${it.title || it.slug}`} onClick={() => removeAt(i)}>
								<adc-icon-close />
							</adc-button-rounded>
						</li>
					))}
				</ol>
			</div>
			<div>
				<h3>Añadir artículos</h3>
				<p className="text-muted text-sm mb-2">Haz clic o arrastra un artículo al editor de arriba.</p>
				<input
					value={q}
					onChange={(e) => setQ(e.target.value)}
					placeholder="Buscar artículos..."
					className="w-full p-2 rounded-xxl border border-alt bg-surface mb-2"
				/>
				<ul className="flex flex-col gap-1 max-h-64 overflow-y-auto">
					{filteredResults.map((a) => {
						const alreadyAdded = items.some((it) => it.slug === a.slug && it.type === "article");
						return (
							<li key={a.slug}>
								<button
									type="button"
									draggable={!alreadyAdded}
									onDragStart={(e) => handleArticleDragStart(e, a)}
									onClick={() => addArticle(a)}
									disabled={alreadyAdded}
									className={`w-full text-left p-2 rounded-xxl bg-surface hover:bg-alt disabled:opacity-50 disabled:cursor-not-allowed ${alreadyAdded ? "" : "cursor-grab active:cursor-grabbing"}`}
								>
									{a.title} <small className="text-muted">({a.slug})</small>
									{alreadyAdded && <small className="ml-2 text-muted">(añadido)</small>}
								</button>
							</li>
						);
					})}
				</ul>
			</div>
		</div>
	);
}
