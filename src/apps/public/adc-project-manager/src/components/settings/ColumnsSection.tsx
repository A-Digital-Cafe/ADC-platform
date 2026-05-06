import { useState } from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";
import type { Project, KanbanColumn, ProjectSettings } from "@common/types/project-manager/Project.ts";
import { shortId } from "../../utils/ids.ts";
import { pmApi } from "../../utils/pm-api.ts";

interface Props {
	project: Project;
	canEdit: boolean;
	onSaved: () => void | Promise<void>;
}

export function ColumnsSection({ project, canEdit, onSaved }: Props) {
	const { t } = useTranslation({ namespace: "adc-project-manager" });
	const [cols, setCols] = useState<KanbanColumn[]>(() => [...project.kanbanColumns].sort((a, b) => a.order - b.order));
	const [requireComment, setRequireComment] = useState<boolean>(project.settings?.requireCommentOnFinalTransition === true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const update = (id: string, patch: Partial<KanbanColumn>) => {
		setCols((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
	};
	const move = (idx: number, dir: -1 | 1) => {
		const next = [...cols];
		const target = idx + dir;
		if (target < 0 || target >= next.length) return;
		[next[idx], next[target]] = [next[target], next[idx]];
		setCols(next.map((c, i) => ({ ...c, order: i })));
	};
	const add = () => {
		const name = t("settings.newColumn");
		setCols([...cols, { id: shortId(), key: `col-${cols.length + 1}`, name, order: cols.length }]);
	};
	const remove = (id: string) => setCols(cols.filter((c) => c.id !== id).map((c, i) => ({ ...c, order: i })));
	const setAuto = (id: string) => setCols(cols.map((c) => ({ ...c, isAuto: c.id === id })));

	const save = async () => {
		setSaving(true);
		setError(null);
		const colsRes = await pmApi.updateColumns(project.id, cols);
		if (!colsRes.success) {
			setSaving(false);
			setError(colsRes.errorKey ?? "error");
			return;
		}
		const prevRequire = project.settings?.requireCommentOnFinalTransition === true;
		if (prevRequire !== requireComment) {
			const settings: ProjectSettings = { ...(project.settings ?? {}), requireCommentOnFinalTransition: requireComment };
			const sRes = await pmApi.updateSettings(project.id, settings);
			if (!sRes.success) {
				setSaving(false);
				setError(sRes.errorKey ?? "error");
				return;
			}
		}
		setSaving(false);
		await onSaved();
	};

	return (
		<div className="space-y-3">
			<ul className="space-y-2">
				{cols.map((c, i) => (
					<li key={c.id} className="flex items-center gap-2 p-2 border border-border rounded-md bg-surface">
						<div className="flex flex-col">
							<button
								type="button"
								disabled={!canEdit || i === 0}
								onClick={() => move(i, -1)}
								className="text-xs px-1 disabled:opacity-30"
							>
								▲
							</button>
							<button
								type="button"
								disabled={!canEdit || i === cols.length - 1}
								onClick={() => move(i, 1)}
								className="text-xs px-1 disabled:opacity-30"
							>
								▼
							</button>
						</div>
						<adc-input value={c.key} onInput={(e: any) => update(c.id, { key: e.target.value })} disabled={!canEdit} />
						<adc-input value={c.name} onInput={(e: any) => update(c.id, { name: e.target.value })} disabled={!canEdit} />
						<input
							type="color"
							value={c.color ?? "#888888"}
							onChange={(e) => update(c.id, { color: e.target.value })}
							disabled={!canEdit}
							className="h-8 w-10 rounded cursor-pointer"
						/>
						<label className="flex items-center gap-1 text-xs">
							<input type="radio" name="auto-col" checked={!!c.isAuto} onChange={() => setAuto(c.id)} disabled={!canEdit} />
							{t("settings.columnAuto")}
						</label>
						<label className="flex items-center gap-1 text-xs">
							<input
								type="checkbox"
								checked={!!c.isDone}
								onChange={(e) => update(c.id, { isDone: e.target.checked })}
								disabled={!canEdit}
							/>
							{t("settings.columnDone")}
						</label>
						<button
							type="button"
							onClick={() => remove(c.id)}
							disabled={!canEdit || cols.length <= 1}
							className="ml-auto font-bold text-tdanger text-sm disabled:opacity-30"
							aria-label={t("common.delete")}
						>
							×
						</button>
					</li>
				))}
			</ul>
			<div className="pt-3 border-t border-border">
				<label className="flex items-start gap-2 text-sm cursor-pointer">
					<input
						type="checkbox"
						checked={requireComment}
						onChange={(e) => setRequireComment(e.target.checked)}
						disabled={!canEdit}
						className="mt-1"
					/>
					<span>
						<span className="font-medium block">
							{t("settings.requireCommentOnFinalTransition") ?? "Requerir comentario al cerrar"}
						</span>
						<span className="text-xs text-muted">
							{t("settings.requireCommentOnFinalTransitionHint") ??
								"Si está activo, mover un issue a una columna final requiere dejar un comentario que documente la razón."}
						</span>
					</span>
				</label>
			</div>
			{canEdit && (
				<div className="flex gap-2">
					<adc-button variant="accent" onClick={add}>
						{t("settings.addColumn")}
					</adc-button>
					<adc-button variant="primary" onClick={save} disabled={saving}>
						{t("common.save")}
					</adc-button>
				</div>
			)}
			{error && <p className="text-sm text-tdanger">{error}</p>}
		</div>
	);
}
