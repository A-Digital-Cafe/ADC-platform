import { useState, useEffect } from "react";
import { router } from "@common/utils/router.js";
import { getSession } from "@ui-library/utils/session";
import { canPublish } from "../../utils/permissions";
import { adminApi, type Article, type Block, type LearningPath, type PathItemLevel } from "../../utils/admin-api";
import { contentAPI } from "../../utils/content-api";
import { BlocksEditor } from "./BlocksEditor";

interface Props {
	readonly article?: Article | null;
}

interface FormState {
	slug: string;
	title: string;
	pathSlug: string;
	pathLevel: PathItemLevel;
	videoUrl: string;
	description: string;
	listed: boolean;
	blocksText: string;
	imageUrl: string;
}

function initialForm(a?: Article | null): FormState {
	return {
		slug: a?.slug || "",
		title: a?.title || "",
		pathSlug: a?.pathSlug || "",
		pathLevel: "importante",
		videoUrl: a?.videoUrl || "",
		description: a?.description || "",
		listed: a?.listed === true,
		blocksText: a?.blocks?.length ? JSON.stringify(a.blocks, null, 2) : "",
		imageUrl: a?.image?.url || "",
	};
}

export function ArticleForm({ article }: Props) {
	const [form, setForm] = useState<FormState>(initialForm(article));
	const [blocks, setBlocks] = useState<Block[]>(article?.blocks || []);
	const [paths, setPaths] = useState<LearningPath[]>([]);
	const [saving, setSaving] = useState(false);
	const [canPub, setCanPub] = useState(false);

	useEffect(() => {
		contentAPI.listPaths({ listed: undefined }).then(setPaths);
		getSession().then((s) => setCanPub(canPublish(s.user?.perms)));
	}, []);

	function update<K extends keyof FormState>(key: K, v: FormState[K]) {
		setForm((f) => ({ ...f, [key]: v }));
	}

	async function handleSubmit(ev: React.SubmitEvent) {
		ev.preventDefault();
		setSaving(true);
		try {
			const payload: Record<string, unknown> = {
				slug: form.slug,
				title: form.title,
				videoUrl: form.videoUrl || undefined,
				blocks,
			};
			if (form.pathSlug) {
				payload.pathSlug = form.pathSlug;
				payload.pathLevel = form.pathLevel;
			}
			if (form.imageUrl) payload.image = { url: form.imageUrl, alt: form.title };
			if (canPub) {
				payload.listed = form.listed;
				payload.description = form.description || undefined;
			}
			const saved = article ? await adminApi.updateArticle(article.slug, payload) : await adminApi.createArticle(payload);
			if (saved) router.navigate(`/articles/${saved.slug || form.slug}`);
		} finally {
			setSaving(false);
		}
	}

	let submitBtnLabel = "Publicar";

	if (saving) submitBtnLabel = "Guardando...";
	else if (article) submitBtnLabel = "Guardar";

	return (
		<form onSubmit={handleSubmit} className="flex flex-col gap-3">
			<label className="flex flex-col gap-1">
				<span>Título</span>
				<input
					value={form.title}
					onChange={(e) => update("title", e.target.value)}
					required
					className="p-2 rounded-xxl border border-alt bg-surface"
				/>
			</label>
			<label className="flex flex-col gap-1">
				<span>Slug</span>
				<input
					value={form.slug}
					onChange={(e) => update("slug", e.target.value)}
					required
					disabled={!!article}
					className="p-2 rounded-xxl border border-alt bg-surface"
				/>
			</label>
			<label className="flex flex-col gap-1">
				<span>Path asociado</span>
				<adc-combobox
					class="[&_input]:rounded-xxl [&_input]:border-0 [&_input]:focus:ring-0"
					value={form.pathSlug}
					placeholder="Ninguno"
					options={JSON.stringify(paths.map((p) => ({ label: p.title, value: p.slug })))}
					onadcChange={(e: any) => update("pathSlug", (e.detail ?? "") as string)}
				/>
			</label>
			{form.pathSlug && (
				<label className="flex flex-col gap-1">
					<span>Nivel en el Path</span>
					<select
						value={form.pathLevel}
						onChange={(e) => update("pathLevel", e.target.value as PathItemLevel)}
						className="p-2 rounded-xxl border border-alt bg-surface"
					>
						<option value="critico">Crítico</option>
						<option value="importante">Importante</option>
						<option value="opcional">Opcional</option>
					</select>
				</label>
			)}
			<label className="flex flex-col gap-1">
				<span>URL de imagen</span>
				<input
					value={form.imageUrl}
					onChange={(e) => update("imageUrl", e.target.value)}
					className="p-2 rounded-xxl border border-alt bg-surface"
				/>
			</label>
			<label className="flex flex-col gap-1">
				<span>Video (URL embed)</span>
				<input
					value={form.videoUrl}
					onChange={(e) => update("videoUrl", e.target.value)}
					className="p-2 rounded-xxl border border-alt bg-surface"
				/>
			</label>
			<BlocksEditor
				value={form.blocksText}
				onChange={(t, p) => {
					update("blocksText", t);
					if (p) setBlocks(p);
				}}
			/>
			{canPub && (
				<>
					<label className="flex items-center gap-2">
						<input type="checkbox" checked={form.listed} onChange={(e) => update("listed", e.target.checked)} />
						<span>Listar en artículos</span>
					</label>
					<label className="flex flex-col gap-1">
						<span>Descripción (para reviewers)</span>
						<textarea
							value={form.description}
							onChange={(e) => update("description", e.target.value)}
							rows={3}
							className="p-2 rounded-xxl border border-alt bg-surface"
						/>
					</label>
				</>
			)}
			<adc-button type="submit" disabled={saving}>
				{submitBtnLabel}
			</adc-button>
		</form>
	);
}
