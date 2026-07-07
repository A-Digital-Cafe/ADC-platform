import { useMemo, useState, useCallback } from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";
import type { Permission } from "@common/types/identity/Permission.js";
import { RESOURCES, type ScopeDef } from "@common/types/resources.js";
import { ACTIONS } from "./constants.ts";
import { buildBitfieldMap, bitfieldMapToPermissions } from "./helpers.ts";
import { ResourceMatrix } from "./ResourceMatrix.tsx";

interface PermissionEditorProps {
	readonly permissions: Permission[];
	readonly onChange: (permissions: Permission[]) => void;
	readonly disabled?: boolean;
	/**
	 * Editando un rol de ORGANIZACIÓN: oculta los recursos `globalOnly`
	 * (security, modules) — sólo asignables en roles globales.
	 */
	readonly orgContext?: boolean;
}

export function PermissionEditor({ permissions, onChange, disabled, orgContext }: PermissionEditorProps) {
	const { t } = useTranslation({ namespace: "adc-identity", autoLoad: true });

	const permMap = useMemo(() => buildBitfieldMap(permissions), [permissions]);

	// Recursos ofrecidos: en contexto org se excluyen los global-only.
	const offeredResources = useMemo(() => (orgContext ? RESOURCES.filter((r) => !r.globalOnly) : RESOURCES), [orgContext]);

	// Track which resources are visible (have permissions OR were explicitly added)
	const [addedResources, setAddedResources] = useState<Set<string>>(new Set());
	const [addingResource, setAddingResource] = useState(false);

	const activeResources = useMemo(() => {
		const active = new Set<string>();
		for (const p of permissions) active.add(p.resource);
		for (const r of addedResources) active.add(r);
		return active;
	}, [permissions, addedResources]);

	const rebuildAll = useCallback((nextBitfield: Map<string, number>) => onChange(bitfieldMapToPermissions(nextBitfield)), [onChange]);

	const toggle = useCallback(
		(resource: string, scope: number, actionValue: number) => {
			if (disabled) return;
			const updated = new Map(permMap);
			const key = `${resource}:${scope}`;
			const current = updated.get(key) ?? 0;
			updated.set(key, (current & actionValue) === actionValue ? current & ~actionValue : current | actionValue);
			rebuildAll(updated);
		},
		[permMap, disabled, rebuildAll]
	);

	const toggleRow = useCallback(
		(resource: string, scope: number) => {
			if (disabled) return;
			const updated = new Map(permMap);
			const key = `${resource}:${scope}`;
			const current = updated.get(key) ?? 0;
			const allActs = ACTIONS.reduce((acc, a) => acc | a.value, 0);
			updated.set(key, current === allActs ? 0 : allActs);
			rebuildAll(updated);
		},
		[permMap, disabled, rebuildAll]
	);

	const toggleCol = useCallback(
		(resource: string, scopes: ScopeDef[], actionValue: number) => {
			if (disabled) return;
			const updated = new Map(permMap);
			const allHave = scopes.every((s) => ((updated.get(`${resource}:${s.value}`) ?? 0) & actionValue) === actionValue);
			for (const scope of scopes) {
				const key = `${resource}:${scope.value}`;
				const current = updated.get(key) ?? 0;
				updated.set(key, allHave ? current & ~actionValue : current | actionValue);
			}
			rebuildAll(updated);
		},
		[permMap, disabled, rebuildAll]
	);

	const removeResource = useCallback(
		(resource: string) => {
			setAddedResources((prev) => {
				const n = new Set(prev);
				n.delete(resource);
				return n;
			});
			const updated = new Map(permMap);
			for (const key of updated.keys()) {
				if (key.startsWith(`${resource}:`)) updated.delete(key);
			}
			rebuildAll(updated);
		},
		[permMap, rebuildAll]
	);

	const addResource = useCallback(
		(resourceId: string) => {
			setAddingResource(false);
			if (activeResources.has(resourceId)) return;
			setAddedResources((prev) => new Set(prev).add(resourceId));
		},
		[activeResources]
	);

	// ── Visible / available ──

	const visibleResources = useMemo(() => offeredResources.filter((r) => activeResources.has(r.id)), [offeredResources, activeResources]);

	const availableResources = useMemo(
		() => offeredResources.filter((r) => !activeResources.has(r.id)),
		[offeredResources, activeResources]
	);

	return (
		<div className="flex flex-col gap-3">
			{visibleResources.map((res) => (
				<ResourceMatrix
					key={res.id}
					resource={res.id}
					scopes={res.scopes}
					permMap={permMap}
					onToggle={toggle}
					onToggleRow={toggleRow}
					onToggleCol={toggleCol}
					onRemove={removeResource}
					disabled={disabled}
					t={t}
				/>
			))}

			{!disabled && availableResources.length > 0 && (
				<div>
					{addingResource ? (
						<div className="flex flex-wrap gap-2">
							{availableResources.map((r) => (
								<button
									key={r.id}
									type="button"
									className="px-3 py-1 text-xs rounded-lg border border-surface hover:border-primary hover:text-primary transition-colors cursor-pointer"
									onClick={() => addResource(r.id)}
								>
									{t(r.label)}
								</button>
							))}
							<button
								type="button"
								className="px-3 py-1 text-xs text-tmuted hover:text-text transition-colors cursor-pointer"
								onClick={() => setAddingResource(false)}
							>
								{t("permissions.cancel")}
							</button>
						</div>
					) : (
						<button
							type="button"
							className="px-3 py-1.5 text-xs rounded-lg border border-dashed border-surface hover:border-primary hover:text-primary transition-colors cursor-pointer"
							onClick={() => setAddingResource(true)}
						>
							+ {t("permissions.addResource")}
						</button>
					)}
				</div>
			)}
		</div>
	);
}
