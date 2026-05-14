import React, { useState, useEffect, useCallback } from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";
import { identityApi } from "../utils/identity-api.ts";
import type { Group, Organization, Permission, Role } from "@common/types/identity/index.d.ts";
import { Scope, canWrite, canUpdate, canDelete } from "../utils/permissions.ts";
import { DataTable, type Column } from "../components/DataTable.tsx";
import { PermissionEditor } from "../components/PermissionEditor/index.ts";
import { DeleteConfirmModal } from "../components/DeleteConfirmModal.tsx";
import { FormModalFooter } from "../components/FormModalFooter.tsx";
import { RolePicker } from "../components/RolePicker.tsx";
import { MembersModal } from "../components/MembersModal.tsx";
import { clearErrors } from "@ui-library/utils/adc-fetch";
import { RowActions } from "../components/RowActions.tsx";

interface GroupsViewProps {
	readonly perms: Permission[];
	readonly orgId?: string;
	readonly organizations?: Organization[];
}

export function GroupsView({ perms, orgId, organizations = [] }: GroupsViewProps) {
	const { t } = useTranslation({ namespace: "adc-identity", autoLoad: true });
	const [groups, setGroups] = useState<Group[]>([]);
	const [filteredGroups, setFilteredGroups] = useState<Group[]>([]);
	const [allRoles, setAllRoles] = useState<Role[]>([]);
	const [loading, setLoading] = useState(true);
	const [modalOpen, setModalOpen] = useState(false);
	const [editingGroup, setEditingGroup] = useState<Group | null>(null);
	const [deleteConfirm, setDeleteConfirm] = useState<Group | null>(null);
	const [membersModal, setMembersModal] = useState<Group | null>(null);
	const orgMap = React.useMemo(() => new Map(organizations.map((o) => [o.orgId, o.slug])), [organizations]);

	// Form state
	const [formName, setFormName] = useState("");
	const [formDescription, setFormDescription] = useState("");
	const [formRoleIds, setFormRoleIds] = useState<string[]>([]);
	const [formPermissions, setFormPermissions] = useState<Permission[]>([]);
	const [submitting, setSubmitting] = useState(false);

	const writable = canWrite(perms, Scope.GROUPS);
	const updatable = canUpdate(perms, Scope.GROUPS);
	const deletable = canDelete(perms, Scope.GROUPS);

	const editModalRef = useCallback((el: HTMLElement | null) => {
		if (el) el.addEventListener("adcClose", () => setModalOpen(false));
	}, []);

	const loadData = useCallback(async () => {
		setLoading(true);
		const [groupsRes, rolesRes] = await Promise.all([identityApi.listGroups(orgId), identityApi.listRoles(orgId)]);
		if (groupsRes.success && groupsRes.data) {
			setGroups(groupsRes.data);
			setFilteredGroups(groupsRes.data);
		}
		if (rolesRes.success && rolesRes.data) setAllRoles(rolesRes.data);
		setLoading(false);
	}, [orgId]);

	useEffect(() => {
		loadData();
	}, [loadData]);

	const handleSearch = (query: string) => {
		if (!query) {
			setFilteredGroups(groups);
			return;
		}
		const q = query.toLowerCase();
		setFilteredGroups(groups.filter((g) => g.name.toLowerCase().includes(q) || g.description?.toLowerCase().includes(q)));
	};

	const getRoleName = (roleId: string) => {
		const role = allRoles.find((r) => r.id === roleId);
		return role?.name || roleId;
	};

	const assignableRoles = React.useMemo(() => {
		if (!orgId) return allRoles;
		return allRoles.filter((role) => role.orgId === orgId || formRoleIds.includes(role.id));
	}, [allRoles, formRoleIds, orgId]);

	const toggleRole = (roleId: string) => {
		setFormRoleIds((prev) => (prev.includes(roleId) ? prev.filter((id) => id !== roleId) : [...prev, roleId]));
	};

	const openCreateModal = () => {
		setEditingGroup(null);
		setFormName("");
		setFormDescription("");
		setFormRoleIds([]);
		setFormPermissions([]);
		setModalOpen(true);
	};

	const openEditModal = (group: Group) => {
		setEditingGroup(group);
		setFormName(group.name);
		setFormDescription(group.description ?? "");
		setFormRoleIds([...group.roleIds]);
		setFormPermissions(group.permissions ? [...group.permissions] : []);
		setModalOpen(true);
	};

	const handleSubmit = async (e: React.SubmitEvent) => {
		e.preventDefault();
		clearErrors();
		setSubmitting(true);

		const payload = {
			name: formName,
			description: formDescription,
			roleIds: formRoleIds,
			permissions: formPermissions,
		};

		if (editingGroup) {
			const result = await identityApi.updateGroup(editingGroup.id, payload);
			if (result.success) {
				setModalOpen(false);
				loadData();
			}
		} else {
			const result = await identityApi.createGroup({ ...payload, orgId });
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
		const result = await identityApi.deleteGroup(deleteConfirm.id);
		if (result.success) {
			setDeleteConfirm(null);
			loadData();
		}
	};

	const columns: Column<Group>[] = [
		{ key: "name", label: t("groups.name") },
		{ key: "description", label: t("groups.description") },
		{
			key: "roleIds",
			label: t("groups.roles"),
			render: (g) => (
				<div className="flex flex-wrap gap-1">
					{g.roleIds.length === 0 ? (
						<span className="text-muted text-xs">{t("groups.noRoles")}</span>
					) : (
						g.roleIds.slice(0, 3).map((rid) => (
							<adc-badge key={rid} color="blue" size="sm">
								{getRoleName(rid)}
							</adc-badge>
						))
					)}
					{g.roleIds.length > 3 && (
						<adc-badge color="gray" size="sm">
							+{g.roleIds.length - 3}
						</adc-badge>
					)}
				</div>
			),
		},
		{
			key: "orgId",
			label: t("groups.scope"),
			render: (g: Group) =>
				g.orgId ? (
					<adc-badge color="indigo" size="sm">
						{orgMap.get(g.orgId) || t("groups.orgScope")}
					</adc-badge>
				) : (
					<adc-badge color="gray" size="sm">
						{t("groups.globalScope")}
					</adc-badge>
				),
		},
	];

	return (
		<>
			<DataTable
				columns={columns}
				data={filteredGroups}
				loading={loading}
				searchPlaceholder={t("groups.searchPlaceholder")}
				onSearch={handleSearch}
				onAdd={writable ? openCreateModal : undefined}
				addLabel={t("groups.addGroup")}
				keyExtractor={(g) => g.id}
				emptyMessage={t("groups.noGroups")}
				actions={(group) => {
					const isOwnContext = orgId ? group.orgId === orgId : !group.orgId;
					return (
						<RowActions
							item={group}
							canEdit={updatable && isOwnContext}
							canDelete={deletable && isOwnContext}
							canManageMembers={updatable && isOwnContext}
							onEdit={openEditModal}
							onDelete={setDeleteConfirm}
							onManageMembers={setMembersModal}
							editLabel={t("common.edit")}
							deleteLabel={t("common.delete")}
							membersLabel={t("groups.members")}
						/>
					);
				}}
			/>

			{/* Create/Edit Modal */}
			{modalOpen && (
				<adc-modal ref={editModalRef} open modalTitle={editingGroup ? t("groups.editGroup") : t("groups.addGroup")} size="lg">
					<form onSubmit={handleSubmit} className="space-y-4">
						<div>
							<label className="block text-sm font-medium mb-1 text-text">{t("groups.name")}</label>
							<adc-input
								value={formName}
								placeholder={t("groups.namePlaceholder")}
								onInput={(e: any) => setFormName(e.target.value)}
							/>
						</div>
						<div>
							<label className="block text-sm font-medium mb-1 text-text">{t("groups.description")}</label>
							<adc-input
								value={formDescription}
								placeholder={t("groups.descriptionPlaceholder")}
								onInput={(e: any) => setFormDescription(e.target.value)}
							/>
						</div>
						<div>
							<label className="block text-sm font-medium mb-1 text-text">{t("groups.roles")}</label>
							<RolePicker roles={assignableRoles} selectedIds={formRoleIds} onToggle={toggleRole} />
						</div>
						<div>
							<label className="block text-sm font-medium mb-1 text-text">{t("permissions.directTitle")}</label>
							<p className="text-xs text-muted mb-2">{t("permissions.directHintGroup")}</p>
							<PermissionEditor permissions={formPermissions} onChange={setFormPermissions} />
						</div>
						<FormModalFooter onCancel={() => setModalOpen(false)} submitting={submitting} />
					</form>
				</adc-modal>
			)}

			{membersModal && (
				<MembersModal
					title={t("groups.manageMembers", { name: membersModal.name })}
					searchPlaceholder={t("groups.searchUserPlaceholder")}
					noMembersText={t("groups.noMembers")}
					entityId={membersModal.id}
					orgId={membersModal.orgId || orgId}
					onClose={() => setMembersModal(null)}
					fetchMembers={async (id) => {
						const res = await identityApi.listGroupMembers(id);
						return res.success && res.data ? res.data : [];
					}}
					onAddMember={async (id, userId) => {
						const result = await identityApi.addUserToGroup(id, userId, membersModal.orgId || orgId);
						return result.success;
					}}
					onRemoveMember={async (id, userId) => {
						const result = await identityApi.removeUserFromGroup(id, userId, membersModal.orgId || orgId);
						return result.success;
					}}
				/>
			)}

			{deleteConfirm && (
				<DeleteConfirmModal
					message={t("groups.deleteConfirm", { name: deleteConfirm.name })}
					onClose={() => setDeleteConfirm(null)}
					onConfirm={handleDelete}
				/>
			)}
		</>
	);
}
