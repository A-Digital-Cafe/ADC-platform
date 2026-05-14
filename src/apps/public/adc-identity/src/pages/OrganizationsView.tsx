import React, { useState, useEffect, useCallback } from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";
import type { Organization, RegionInfo, Permission, OrganizationStatus, OrganizationTier } from "@common/types/identity/index.d.ts";
import { identityApi } from "../utils/identity-api.ts";
import { Scope, canWrite, canUpdate, canDelete } from "../utils/permissions.ts";
import { DataTable, type Column } from "../components/DataTable.tsx";
import { DeleteConfirmModal } from "../components/DeleteConfirmModal.tsx";
import { FormModalFooter } from "../components/FormModalFooter.tsx";
import { MembersModal } from "../components/MembersModal.tsx";
import { clearErrors } from "@ui-library/utils/adc-fetch";
import { RowActions } from "../components/RowActions.tsx";

const ORG_STATUSES = ["active", "inactive", "blocked"] as const;

const statusColors: Record<string, "green" | "gray" | "red"> = {
	active: "green",
	inactive: "gray",
	blocked: "red",
};

export function OrganizationsView({ perms }: { readonly perms: Permission[] }) {
	const { t } = useTranslation({ namespace: "adc-identity", autoLoad: true });
	const [orgs, setOrgs] = useState<Organization[]>([]);
	const [filteredOrgs, setFilteredOrgs] = useState<Organization[]>([]);
	const [allRegions, setAllRegions] = useState<RegionInfo[]>([]);
	const [loading, setLoading] = useState(true);
	const [modalOpen, setModalOpen] = useState(false);
	const [editingOrg, setEditingOrg] = useState<Organization | null>(null);
	const [deleteConfirm, setDeleteConfirm] = useState<Organization | null>(null);
	const [membersModal, setMembersModal] = useState<Organization | null>(null);

	// Form state
	const [formSlug, setFormSlug] = useState("");
	const [formRegion, setFormRegion] = useState("");
	const [formTier, setFormTier] = useState("");
	const [formStatus, setFormStatus] = useState<string>("active");
	const [submitting, setSubmitting] = useState(false);

	const writable = canWrite(perms, Scope.ORGANIZATIONS);
	const updatable = canUpdate(perms, Scope.ORGANIZATIONS);
	const deletable = canDelete(perms, Scope.ORGANIZATIONS);

	const editModalRef = useCallback((el: HTMLElement | null) => {
		if (el) el.addEventListener("adcClose", () => setModalOpen(false));
	}, []);

	const loadData = useCallback(async () => {
		setLoading(true);
		const [orgsRes, regionsRes] = await Promise.all([identityApi.listOrganizations(), identityApi.listRegions()]);
		if (orgsRes.success && orgsRes.data) {
			setOrgs(orgsRes.data);
			setFilteredOrgs(orgsRes.data);
		}
		if (regionsRes.success && regionsRes.data) setAllRegions(regionsRes.data);
		setLoading(false);
	}, []);

	useEffect(() => {
		loadData();
	}, [loadData]);

	const handleSearch = (query: string) => {
		if (!query) {
			setFilteredOrgs(orgs);
			return;
		}
		const q = query.toLowerCase();
		setFilteredOrgs(
			orgs.filter((o) => o.slug.toLowerCase().includes(q) || o.region.toLowerCase().includes(q) || o.tier?.toLowerCase().includes(q))
		);
	};

	const openCreateModal = () => {
		setEditingOrg(null);
		setFormSlug("");
		setFormRegion(allRegions[0]?.path || "");
		setFormTier("");
		setFormStatus("active");
		setModalOpen(true);
	};

	const openEditModal = (org: Organization) => {
		setEditingOrg(org);
		setFormSlug(org.slug);
		setFormRegion(org.region);
		setFormTier(org.tier || "");
		setFormStatus(org.status);
		setModalOpen(true);
	};

	const handleSubmit = async (e: React.SubmitEvent) => {
		e.preventDefault();
		clearErrors();
		setSubmitting(true);

		const payload = {
			slug: formSlug,
			region: formRegion,
			tier: (formTier as OrganizationTier) || undefined,
			status: formStatus as OrganizationStatus,
		};

		if (editingOrg) {
			const result = await identityApi.updateOrganization(editingOrg.orgId, payload);
			if (result.success) {
				setModalOpen(false);
				loadData();
			}
		} else {
			const result = await identityApi.createOrganization(payload);
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
		const result = await identityApi.deleteOrganization(deleteConfirm.orgId);
		if (result.success) {
			setDeleteConfirm(null);
			loadData();
		}
	};

	const columns: Column<Organization>[] = [
		{ key: "slug", label: t("organizations.slug") },
		{ key: "region", label: t("organizations.region") },
		{
			key: "tier",
			label: t("organizations.tier"),
			render: (o) => <span className="text-text">{o.tier || "-"}</span>,
		},
		{
			key: "status",
			label: t("organizations.status"),
			render: (o) => (
				<adc-badge color={statusColors[o.status] || "gray"} size="sm" dot>
					{t(`organizations.statuses.${o.status}`)}
				</adc-badge>
			),
		},
		{
			key: "createdAt",
			label: t("organizations.createdAt"),
			render: (o) => <span className="text-muted text-xs">{o.createdAt ? new Date(o.createdAt).toLocaleDateString() : "-"}</span>,
		},
	];

	return (
		<>
			<DataTable
				columns={columns}
				data={filteredOrgs}
				loading={loading}
				searchPlaceholder={t("organizations.searchPlaceholder")}
				onSearch={handleSearch}
				onAdd={writable ? openCreateModal : undefined}
				addLabel={t("organizations.addOrganization")}
				keyExtractor={(o) => o.orgId}
				emptyMessage={t("organizations.noOrganizations")}
				actions={(org) => (
					<RowActions
						item={org}
						canEdit={updatable}
						canDelete={deletable}
						canManageMembers={updatable}
						onEdit={openEditModal}
						onDelete={setDeleteConfirm}
						onManageMembers={setMembersModal}
						editLabel={t("common.edit")}
						deleteLabel={t("common.delete")}
						membersLabel={t("organizations.members")}
					/>
				)}
			/>

			{/* Create/Edit Modal */}
			{modalOpen && (
				<adc-modal
					ref={editModalRef}
					open
					modalTitle={editingOrg ? t("organizations.editOrganization") : t("organizations.addOrganization")}
					size="md"
				>
					<form onSubmit={handleSubmit} className="space-y-4">
						<div>
							<label className="block text-sm font-medium mb-1 text-text">{t("organizations.slug")}</label>
							<adc-input
								value={formSlug}
								placeholder={t("organizations.slugPlaceholder")}
								onInput={(e: any) => setFormSlug(e.target.value)}
							/>
						</div>
						<div>
							<label className="block text-sm font-medium mb-1 text-text">{t("organizations.region")}</label>
							<adc-select
								value={formRegion}
								onChange={(e: any) => setFormRegion(e.target.value)}
								options={JSON.stringify(
									allRegions.map((r) => ({
										label: r.path + (r.isGlobal ? ` (${t("regions.global")})` : ""),
										value: r.path,
									}))
								)}
							/>
						</div>
						<div>
							<label className="block text-sm font-medium mb-1 text-text">{t("organizations.tier")}</label>
							<adc-input
								value={formTier}
								placeholder={t("organizations.tierPlaceholder")}
								onInput={(e: any) => setFormTier(e.target.value)}
							/>
						</div>
						<div>
							<label className="block text-sm font-medium mb-1 text-text">{t("organizations.status")}</label>
							<adc-select
								value={formStatus}
								onChange={(e: any) => setFormStatus(e.target.value)}
								options={JSON.stringify(
									ORG_STATUSES.map((s) => ({
										label: t(`organizations.statuses.${s}`),
										value: s,
									}))
								)}
							/>
						</div>
						<FormModalFooter onCancel={() => setModalOpen(false)} submitting={submitting} />
					</form>
				</adc-modal>
			)}

			{/* Members Modal */}
			{membersModal && (
				<MembersModal
					title={t("organizations.manageMembers", { slug: membersModal.slug })}
					searchPlaceholder={t("organizations.searchUserPlaceholder")}
					noMembersText={t("organizations.noMembers")}
					entityId={membersModal.orgId}
					onClose={() => setMembersModal(null)}
					fetchMembers={(orgId) => identityApi.listOrgMembers(orgId).then((res) => res.data || [])}
					onAddMember={(orgId, userId) => identityApi.addUserToOrg(orgId, userId).then((res) => res.success || false)}
					onRemoveMember={(orgId, userId) => identityApi.removeUserFromOrg(orgId, userId).then((res) => res.success || false)}
				/>
			)}

			{/* Delete Confirmation */}
			{deleteConfirm && (
				<DeleteConfirmModal
					message={t("organizations.deleteConfirm", { slug: deleteConfirm.slug })}
					onClose={() => setDeleteConfirm(null)}
					onConfirm={handleDelete}
				/>
			)}
		</>
	);
}
