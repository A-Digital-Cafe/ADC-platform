import React, { useState, useEffect, useCallback } from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";
import { identityApi } from "@ui-library/utils/api-identity";
import type { RegionInfo, Permission } from "@common/types/identity/index.d.ts";
import { Scope, canWrite, canUpdate, canDelete } from "../utils/permissions.ts";
import { DataTable, type Column } from "../components/DataTable.tsx";
import { DeleteConfirmModal } from "../components/DeleteConfirmModal.tsx";
import { FormModalFooter } from "../components/FormModalFooter.tsx";
import { clearErrors } from "@ui-library/utils/adc-fetch";
import { RowActions } from "../components/RowActions.tsx";

export function RegionsView({ perms }: { readonly perms: Permission[] }) {
	const { t } = useTranslation({ namespace: "adc-identity", autoLoad: true });
	const [regions, setRegions] = useState<RegionInfo[]>([]);
	const [filteredRegions, setFilteredRegions] = useState<RegionInfo[]>([]);
	const [loading, setLoading] = useState(true);
	const [modalOpen, setModalOpen] = useState(false);
	const [editingRegion, setEditingRegion] = useState<RegionInfo | null>(null);
	const [deleteConfirm, setDeleteConfirm] = useState<RegionInfo | null>(null);

	// Form state
	const [formPath, setFormPath] = useState("");
	const [formIsGlobal, setFormIsGlobal] = useState(false);
	const [formIsActive, setFormIsActive] = useState(true);
	const [formObjectUri, setFormObjectUri] = useState("");
	const [formCacheUri, setFormCacheUri] = useState("");
	const [submitting, setSubmitting] = useState(false);

	const writable = canWrite(perms, Scope.REGIONS);
	const updatable = canUpdate(perms, Scope.REGIONS);
	const deletable = canDelete(perms, Scope.REGIONS);

	const editModalRef = useCallback((el: HTMLElement | null) => {
		if (el) el.addEventListener("adcClose", () => setModalOpen(false));
	}, []);
	const globalToggleRef = useCallback((el: HTMLElement | null) => {
		if (el) el.addEventListener("adcChange", (e: Event) => setFormIsGlobal((e as CustomEvent<boolean>).detail));
	}, []);
	const activeToggleRef = useCallback((el: HTMLElement | null) => {
		if (el) el.addEventListener("adcChange", (e: Event) => setFormIsActive((e as CustomEvent<boolean>).detail));
	}, []);

	const loadData = useCallback(async () => {
		setLoading(true);
		const result = await identityApi.listRegions();
		if (result.success && result.data) {
			setRegions(result.data);
			setFilteredRegions(result.data);
		}
		setLoading(false);
	}, []);

	useEffect(() => {
		loadData();
	}, [loadData]);

	const handleSearch = (query: string) => {
		if (!query) {
			setFilteredRegions(regions);
			return;
		}
		const q = query.toLowerCase();
		setFilteredRegions(regions.filter((r) => r.path.toLowerCase().includes(q)));
	};

	const openCreateModal = () => {
		setEditingRegion(null);
		setFormPath("");
		setFormIsGlobal(false);
		setFormIsActive(true);
		setFormObjectUri("");
		setFormCacheUri("");
		setModalOpen(true);
	};

	const openEditModal = (region: RegionInfo) => {
		setEditingRegion(region);
		setFormPath(region.path);
		setFormIsGlobal(region.isGlobal);
		setFormIsActive(region.isActive);
		setFormObjectUri(region.metadata?.objectConnectionUri || "");
		setFormCacheUri(region.metadata?.cacheConnectionUri || "");
		setModalOpen(true);
	};

	const handleSubmit = async (e: React.SubmitEvent) => {
		e.preventDefault();
		clearErrors();
		setSubmitting(true);

		const payload = {
			path: formPath,
			isGlobal: formIsGlobal,
			isActive: formIsActive,
			metadata: {
				objectConnectionUri: formObjectUri || undefined,
				cacheConnectionUri: formCacheUri || undefined,
			},
		};

		if (editingRegion) {
			const result = await identityApi.updateRegion(editingRegion.path, payload);
			if (result.success) {
				setModalOpen(false);
				loadData();
			}
		} else {
			const result = await identityApi.createRegion(payload);
			if (result.success) {
				setModalOpen(false);
				loadData();
			}
		}
		setSubmitting(false);
	};

	const handleDelete = async () => {
		if (!deleteConfirm) return;
		clearErrors();
		const result = await identityApi.deleteRegion(deleteConfirm.path);
		if (result.success) {
			setDeleteConfirm(null);
			loadData();
		}
	};

	const columns: Column<RegionInfo>[] = [
		{ key: "path", label: t("regions.path") },
		{
			key: "isGlobal",
			label: t("regions.scope"),
			render: (r) => (
				<adc-badge color={r.isGlobal ? "teal" : "blue"} size="sm">
					{r.isGlobal ? t("regions.global") : t("regions.local")}
				</adc-badge>
			),
		},
		{
			key: "isActive",
			label: t("regions.status"),
			render: (r) => (
				<adc-badge color={r.isActive ? "green" : "gray"} size="sm" dot>
					{r.isActive ? t("common.active") : t("common.inactive")}
				</adc-badge>
			),
		},
		{
			key: "metadata",
			label: t("regions.connections"),
			render: (r) => {
				const hasDb = !!r.metadata?.objectConnectionUri;
				const hasCache = !!r.metadata?.cacheConnectionUri;
				return (
					<div className="flex gap-1">
						{hasDb && (
							<adc-badge color="purple" size="sm">
								DB
							</adc-badge>
						)}
						{hasCache && (
							<adc-badge color="orange" size="sm">
								Cache
							</adc-badge>
						)}
						{!hasDb && !hasCache && <span className="text-muted text-xs">-</span>}
					</div>
				);
			},
		},
		{
			key: "createdAt",
			label: t("regions.createdAt"),
			render: (r) => <span className="text-muted text-xs">{r.createdAt ? new Date(r.createdAt).toLocaleDateString() : "-"}</span>,
		},
	];

	return (
		<>
			<DataTable
				columns={columns}
				data={filteredRegions}
				loading={loading}
				searchPlaceholder={t("regions.searchPlaceholder")}
				onSearch={handleSearch}
				onAdd={writable ? openCreateModal : undefined}
				addLabel={t("regions.addRegion")}
				keyExtractor={(r) => r.path}
				emptyMessage={t("regions.noRegions")}
				actions={(region) => (
					<RowActions
						item={region}
						canEdit={updatable}
						canDelete={deletable}
						onEdit={openEditModal}
						onDelete={setDeleteConfirm}
						editLabel={t("common.edit")}
						deleteLabel={t("common.delete")}
					/>
				)}
			/>

			{/* Create/Edit Modal */}
			{modalOpen && (
				<adc-modal ref={editModalRef} open modalTitle={editingRegion ? t("regions.editRegion") : t("regions.addRegion")} size="md">
					<form onSubmit={handleSubmit} className="space-y-4">
						<div>
							<label className="block text-sm font-medium mb-1 text-text">{t("regions.path")}</label>
							<adc-input
								value={formPath}
								placeholder={t("regions.pathPlaceholder")}
								onInput={(e: any) => setFormPath(e.target.value)}
								disabled={!!editingRegion}
							/>
							<p className="text-xs text-muted mt-1">{t("regions.pathHint")}</p>
						</div>
						<div className="flex gap-6">
							<div className="flex items-center gap-2">
								<adc-toggle ref={globalToggleRef} checked={formIsGlobal} label={t("regions.global")} />
							</div>
							<div className="flex items-center gap-2">
								<adc-toggle ref={activeToggleRef} checked={formIsActive} label={t("common.active")} />
							</div>
						</div>
						<div>
							<label className="block text-sm font-medium mb-1 text-text">{t("regions.objectConnectionUri")}</label>
							<adc-input
								value={formObjectUri}
								placeholder="mongodb://..."
								onInput={(e: any) => setFormObjectUri(e.target.value)}
							/>
						</div>
						<div>
							<label className="block text-sm font-medium mb-1 text-text">{t("regions.cacheConnectionUri")}</label>
							<adc-input value={formCacheUri} placeholder="redis://..." onInput={(e: any) => setFormCacheUri(e.target.value)} />
						</div>
						<FormModalFooter onCancel={() => setModalOpen(false)} submitting={submitting} />
					</form>
				</adc-modal>
			)}

			{/* Delete Confirmation */}
			{deleteConfirm && (
				<DeleteConfirmModal
					message={t("regions.deleteConfirm", { path: deleteConfirm.path })}
					onClose={() => setDeleteConfirm(null)}
					onConfirm={handleDelete}
				/>
			)}
		</>
	);
}
