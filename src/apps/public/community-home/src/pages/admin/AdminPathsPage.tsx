import "@ui-library/utils/react-jsx";
import { useEffect, useState } from "react";
import { getSession } from "@ui-library/utils/session";
import { canPublish } from "../../utils/permissions";
import { contentAPI, type LearningPath } from "../../utils/content-api";
import { adminApi, pathBannerApi, pathBannerRawUrl } from "../../utils/admin-api";
import { AdminGate } from "../../components/admin/AdminGate";
import { PathItemsEditor, type PathItem } from "../../components/admin/PathItemsEditor";
import { ConfirmModal } from "../../components/ConfirmModal";

/** Forma populada que devuelve el backend: los items incluyen el `element`
 *  (artículo o sub-path) resuelto, con su `title`. Ver content-service/endpoints/paths.ts. */
type PopulatedPathItem = LearningPath["items"][number] & { element?: { title?: string } };

const COLORS = ["red", "orange", "yellow", "green", "teal", "blue", "purple", "pink"] as const;

interface FormState {
	slug: string;
	title: string;
	description: string;
	color: string;
	public: boolean;
	listed: boolean;
	items: PathItem[];
}

function initialForm(p?: LearningPath | null): FormState {
	return {
		slug: p?.slug || "",
		title: p?.title || "",
		description: p?.description || "",
		color: p?.color || "red",
		public: p?.public !== false,
		listed: p?.listed === true,
		items: ((p?.items || []) as PopulatedPathItem[]).map((it) => ({
			slug: it.slug,
			type: it.type,
			level: it.level || "importante",
			title: it.element?.title,
		})),
	};
}

function PathsAdminBody() {
	const [paths, setPaths] = useState<LearningPath[]>([]);
	const [editing, setEditing] = useState<string | null>(null);
	const [form, setForm] = useState<FormState>(initialForm());
	const [canPub, setCanPub] = useState(false);
	const [saving, setSaving] = useState(false);
	const [hasBanner, setHasBanner] = useState(false);
	const [bannerBusy, setBannerBusy] = useState(false);
	const [bannerVersion, setBannerVersion] = useState(0);
	const [confirmSlug, setConfirmSlug] = useState<string | null>(null);
	const [deletingPath, setDeletingPath] = useState(false);

	useEffect(() => {
		refresh();
		getSession().then((s) => setCanPub(canPublish(s.user?.perms)));
		// Auto-abrir edición si viene ?slug=... en la URL (e.g. desde el botón editar en PathPage)
		const initialSlug = new URLSearchParams(globalThis.location?.search ?? "").get("slug");
		if (initialSlug) startEdit(initialSlug);
	}, []);

	async function refresh() {
		setPaths(await contentAPI.listPaths({ listed: undefined }));
	}

	async function startEdit(slug: string) {
		const p = await contentAPI.getPath(slug);
		if (!p) return;
		setEditing(slug);
		setForm(initialForm(p));
		setHasBanner(!!(p as { bannerAttachmentId?: string }).bannerAttachmentId);
		setBannerVersion((v) => v + 1);
	}

	function resetForm() {
		setEditing(null);
		setForm(initialForm());
		setHasBanner(false);
	}

	async function handleBannerUpload(ev: React.ChangeEvent<HTMLInputElement>) {
		const file = ev.target.files?.[0];
		ev.target.value = "";
		if (!file || !editing) return;
		setBannerBusy(true);
		try {
			const ok = await pathBannerApi.upload(editing, file);
			if (ok) {
				setHasBanner(true);
				setBannerVersion((v) => v + 1);
			}
		} finally {
			setBannerBusy(false);
		}
	}

	async function handleBannerRemove() {
		if (!editing) return;
		setBannerBusy(true);
		try {
			const ok = await pathBannerApi.remove(editing);
			if (ok) setHasBanner(false);
		} finally {
			setBannerBusy(false);
		}
	}

	async function handleSubmit(ev: React.SubmitEvent) {
		ev.preventDefault();
		setSaving(true);
		try {
			const payload: Record<string, unknown> = {
				slug: form.slug,
				title: form.title,
				description: form.description || undefined,
				color: form.color,
				items: form.items.map(({ slug, type, level }) => ({ slug, type, level })),
			};
			if (canPub) {
				payload.public = form.public;
				payload.listed = form.listed;
			}
			const saved = editing ? await adminApi.updatePath(editing, payload) : await adminApi.createPath(payload);
			if (saved) {
				await refresh();
				resetForm();
			}
		} finally {
			setSaving(false);
		}
	}

	async function doDeletePath() {
		if (!confirmSlug) return;
		setDeletingPath(true);
		const ok = await adminApi.deletePath(confirmSlug);
		setDeletingPath(false);
		if (ok) {
			await refresh();
			if (editing === confirmSlug) resetForm();
		}
		setConfirmSlug(null);
	}
	let btnLabel;
	if (saving) btnLabel = "Guardando...";
	else if (editing) btnLabel = "Guardar";
	else btnLabel = "Crear";

	return (
		<div className="p-8 grid gap-6 md:grid-cols-2">
			<form onSubmit={handleSubmit} className="flex flex-col gap-3">
				<h1>{editing ? `Editar: ${editing}` : "Nuevo Learning Path"}</h1>
				<input
					placeholder="Título"
					value={form.title}
					onChange={(e) => setForm({ ...form, title: e.target.value })}
					required
					className="p-2 rounded-xxl border border-alt bg-surface"
				/>
				<input
					placeholder="Slug"
					value={form.slug}
					onChange={(e) => setForm({ ...form, slug: e.target.value })}
					required
					disabled={!!editing}
					className="p-2 rounded-xxl border border-alt bg-surface"
				/>
				<textarea
					placeholder="Descripción"
					value={form.description}
					onChange={(e) => setForm({ ...form, description: e.target.value })}
					rows={3}
					className="p-2 rounded-xxl border border-alt bg-surface"
				/>
				<label className="flex items-center gap-2">
					<span>Color</span>
					<select
						value={form.color}
						onChange={(e) => setForm({ ...form, color: e.target.value })}
						className="p-2 rounded-xxl border border-alt bg-surface"
					>
						{COLORS.map((c) => (
							<option key={c} value={c}>
								{c}
							</option>
						))}
					</select>
				</label>
				{canPub && (
					<>
						<label className="flex items-center gap-2">
							<input type="checkbox" checked={form.public} onChange={(e) => setForm({ ...form, public: e.target.checked })} />{" "}
							Público
						</label>
						<label className="flex items-center gap-2">
							<input type="checkbox" checked={form.listed} onChange={(e) => setForm({ ...form, listed: e.target.checked })} />{" "}
							Listado
						</label>
					</>
				)}
				{editing && (
					<div className="flex flex-col gap-2 p-3 rounded-xxl border border-alt bg-surface">
						<span className="text-sm opacity-80">Banner</span>
						{hasBanner && (
							<img
								src={`${pathBannerRawUrl(editing)}?v=${bannerVersion}`}
								alt={`Banner de ${form.title}`}
								className="w-full max-h-40 object-cover rounded-xl"
							/>
						)}
						<div className="flex items-center gap-2">
							<label className="cursor-pointer text-sm underline">
								{hasBanner ? "Reemplazar banner" : "Subir banner"}
								<input type="file" accept="image/*" className="hidden" onChange={handleBannerUpload} disabled={bannerBusy} />
							</label>
							{hasBanner && (
								<button
									type="button"
									className="text-sm text-red-500 bg-transparent border-0 cursor-pointer"
									onClick={handleBannerRemove}
									disabled={bannerBusy}
								>
									Quitar
								</button>
							)}
							{bannerBusy && <span className="text-sm opacity-60">Procesando…</span>}
						</div>
					</div>
				)}
				<PathItemsEditor items={form.items} onChange={(items) => setForm({ ...form, items })} excludePathSlug={editing || undefined} />
				<div className="flex gap-2">
					{/* Usamos `label` en vez de slot: adc-button (shadow:false) tiene un MutationObserver
					    que dispara forceUpdate ante cambios de slot y, bajo React.StrictMode, el texto
					    puede quedar fuera del slot-fb y no renderizarse. `label` es un prop reactivo. */}
					<adc-button type="submit" disabled={saving} aria-label={editing ? "Guardar path" : "Crear path"} label={btnLabel} />
					{editing && <adc-button type="button" variant="accent-outlined" aria-label="Cancelar edición" onClick={resetForm} label="Cancelar" />}
				</div>
			</form>
			<div>
				<h2>Paths existentes</h2>
				<ul className="flex flex-col gap-2 mt-2">
					{paths.map((p) => (
						<li
							key={p.slug}
							className="px-4 py-3 bg-surface rounded-xxl flex items-center justify-between gap-3 hover:bg-alt transition-colors"
						>
							<button
								type="button"
								className="min-w-0 flex-1 truncate text-left bg-transparent border-0 p-0 text-text cursor-pointer"
								onClick={() => startEdit(p.slug)}
								aria-label={`Editar ${p.title}`}
							>
								{p.title}
							</button>
							<span className="flex gap-1 items-center">
								<adc-button-rounded aria-label={`Editar ${p.title}`} onClick={() => startEdit(p.slug)}>
									<adc-icon-edit />
								</adc-button-rounded>
								{canPub && (
									<adc-button-rounded variant="danger" aria-label={`Eliminar ${p.title}`} onClick={() => setConfirmSlug(p.slug)}>
										<adc-icon-trash />
									</adc-button-rounded>
								)}
							</span>
						</li>
					))}
				</ul>
			</div>
			{confirmSlug && (
				<ConfirmModal
					message={`¿Eliminar el path "${confirmSlug}"?`}
					busy={deletingPath}
					onClose={() => setConfirmSlug(null)}
					onConfirm={doDeletePath}
				/>
			)}
		</div>
	);
}

export function AdminPathsPage() {
	return <AdminGate requirePublish>{() => <PathsAdminBody />}</AdminGate>;
}
