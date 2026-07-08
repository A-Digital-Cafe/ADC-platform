import React, { useState, useEffect, useCallback } from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";
import { identityApi } from "@ui-library/utils/api-identity";
import type { Organization, Permission, Role } from "@common/types/identity/index.d.ts";
import { Scope, canWrite, canUpdate, canDelete } from "../utils/permissions.ts";
import { DataTable, type Column } from "../components/DataTable.tsx";
import { PermissionEditor } from "../components/PermissionEditor/index.ts";
import { DeleteConfirmModal } from "../components/DeleteConfirmModal.tsx";
import { FormModalFooter } from "../components/FormModalFooter.tsx";
import { clearErrors } from "@ui-library/utils/adc-fetch";
import { RowActions } from "../components/RowActions.tsx";

/** Tamaño de página del listado (server-side: el endpoint devuelve la página + total). */
const PAGE_SIZE = 10;

interface RolesViewProps {
	readonly perms: Permission[];
	readonly orgId?: string;
	readonly organizations?: Organization[];
}

export function RolesView({ perms, orgId, organizations = [] }: RolesViewProps) {
	const { t } = useTranslation({ namespace: "adc-identity", autoLoad: true });
	const [roles, setRoles] = useState<Role[]>([]);
	// Paginación server-side: el endpoint devuelve la página + total (la colección puede superar el cap del server).
	const [pageIndex, setPageIndex] = useState(1);
	const [total, setTotal] = useState(0);
	const [searchQuery, setSearchQuery] = useState("");
	// Sólo el primer fetch muestra skeleton: los cambios de página/búsqueda mantienen la tabla montada.
	const [initialLoading, setInitialLoading] = useState(true);
	const [modalOpen, setModalOpen] = useState(false);
	const [editingRole, setEditingRole] = useState<Role | null>(null);
	const [deleteConfirm, setDeleteConfirm] = useState<Role | null>(null);
	const orgMap = React.useMemo(() => new Map(organizations.map((o) => [o.orgId, o.slug])), [organizations]);

	// Form state
	const [formName, setFormName] = useState("");
	const [formDescription, setFormDescription] = useState("");
	const [formPermissions, setFormPermissions] = useState<Permission[]>([]);
	const [formHierarchy, setFormHierarchy] = useState(100);
	const [submitting, setSubmitting] = useState(false);

	const writable = canWrite(perms, Scope.ROLES);
	const updatable = canUpdate(perms, Scope.ROLES);
	const deletable = canDelete(perms, Scope.ROLES);

	const editModalRef = useCallback((el: HTMLElement | null) => {
		if (el) el.addEventListener("adcClose", () => setModalOpen(false));
	}, []);

	const loadData = useCallback(async () => {
		const q = searchQuery.trim().length >= 2 ? searchQuery.trim() : undefined;
		// ownOnly: la vista de org muestra sólo los roles de ESA org (sin los globales de referencia).
		const result = await identityApi.listRoles({ orgId, ownOnly: !!orgId, q, limit: PAGE_SIZE, offset: (pageIndex - 1) * PAGE_SIZE });
		if (result.success && result.data) {
			const items = result.data.roles ?? [];
			setRoles(items);
			setTotal(result.data.total ?? items.length);
			// Página huérfana (p.ej. tras borrar el último item): retroceder una.
			if (items.length === 0 && pageIndex > 1) setPageIndex(pageIndex - 1);
		}
		setInitialLoading(false);
	}, [orgId, pageIndex, searchQuery]);

	useEffect(() => {
		loadData();
	}, [loadData]);

	const handleSearch = (query: string) => {
		setSearchQuery(query);
		setPageIndex(1);
	};

	const openCreateModal = () => {
		setEditingRole(null);
		setFormName("");
		setFormDescription("");
		setFormPermissions([]);
		setFormHierarchy(100);
		setModalOpen(true);
	};

	const openEditModal = (role: Role) => {
		setEditingRole(role);
		setFormName(role.name);
		setFormDescription(role.description);
		setFormPermissions([...role.permissions]);
		setFormHierarchy(role.hierarchy ?? 100);
		setModalOpen(true);
	};

	const handleSubmit = async (e: React.SubmitEvent) => {
		e.preventDefault();
		clearErrors();
		setSubmitting(true);

		if (editingRole) {
			const result = await identityApi.updateRole(editingRole.id, {
				name: formName,
				description: formDescription,
				permissions: formPermissions,
				hierarchy: formHierarchy,
			});
			if (result.success) {
				setModalOpen(false);
				loadData();
			}
		} else {
			const result = await identityApi.createRole({
				name: formName,
				description: formDescription,
				permissions: formPermissions,
				orgId,
				hierarchy: formHierarchy,
			});
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
		const result = await identityApi.deleteRole(deleteConfirm.id);
		if (result.success) {
			setDeleteConfirm(null);
			loadData();
		}
	};

	const columns: Column<Role>[] = [
		{ key: "name", label: t("roles.name") },
		{ key: "description", label: t("roles.description") },
		{
			key: "isCustom",
			label: t("roles.type"),
			render: (r) => (
				<adc-badge color={r.isCustom ? "purple" : "teal"} size="sm">
					{r.isCustom ? t("roles.custom") : t("roles.predefined")}
				</adc-badge>
			),
		},
		{
			key: "orgId",
			label: t("roles.scope"),
			render: (r: Role) =>
				r.orgId ? (
					<adc-badge color="indigo" size="sm">
						{orgMap.get(r.orgId) || t("roles.orgScope")}
					</adc-badge>
				) : (
					<adc-badge color="gray" size="sm">
						{t("roles.globalScope")}
					</adc-badge>
				),
		},
		{
			key: "hierarchy",
			label: t("roles.hierarchy"),
			render: (r) => <span className="text-muted text-xs">{r.hierarchy ?? 100}</span>,
		},
		{
			key: "permissions",
			label: t("roles.permissions"),
			render: (r) => (
				<span className="text-muted text-xs">
					{r.permissions.length} {t("roles.permissionCount")}
				</span>
			),
		},
	];

	return (
		<>
			<DataTable
				columns={columns}
				data={roles}
				loading={initialLoading}
				pageSize={PAGE_SIZE}
				total={total}
				page={pageIndex}
				onPageChange={setPageIndex}
				searchDebounce={300}
				searchPlaceholder={t("roles.searchPlaceholder")}
				onSearch={handleSearch}
				onAdd={writable ? openCreateModal : undefined}
				addLabel={t("roles.addRole")}
				keyExtractor={(r) => r.id}
				emptyMessage={t("roles.noRoles")}
				actions={(role) => {
					// Editable solo si es custom Y pertenece al contexto correcto
					const isOwnContext = orgId ? role.orgId === orgId : !role.orgId;
					const canEditRole = updatable && role.isCustom && isOwnContext;
					const canDeleteRole = deletable && role.isCustom && isOwnContext;
					return (
						<RowActions
							item={role}
							canEdit={canEditRole}
							canDelete={canDeleteRole}
							onEdit={openEditModal}
							onDelete={setDeleteConfirm}
							editLabel={t("common.edit")}
							deleteLabel={t("common.delete")}
						/>
					);
				}}
			/>

			{/* Create/Edit Modal */}
			{modalOpen && (
				<adc-modal ref={editModalRef} open modalTitle={editingRole ? t("roles.editRole") : t("roles.addRole")} size="lg">
					<form onSubmit={handleSubmit} className="space-y-4">
						<div>
							<label className="block text-sm font-medium mb-1 text-text">{t("roles.name")}</label>
							<adc-input
								value={formName}
								placeholder={t("roles.namePlaceholder")}
								onInput={(e: any) => setFormName(e.target.value)}
							/>
						</div>
						<div>
							<label className="block text-sm font-medium mb-1 text-text">{t("roles.description")}</label>
							<adc-input
								value={formDescription}
								placeholder={t("roles.descriptionPlaceholder")}
								onInput={(e: any) => setFormDescription(e.target.value)}
							/>
						</div>
						<div>
							<label className="block text-sm font-medium mb-1 text-text">{t("roles.hierarchy")}</label>
							<adc-input
								type="number"
								value={String(formHierarchy)}
								placeholder="100"
								onInput={(e: any) => setFormHierarchy(Number(e.target.value) || 0)}
							/>
							<p className="text-xs text-muted mt-1">{t("roles.hierarchyHint")}</p>
						</div>
						<div>
							<label className="block text-sm font-medium mb-1 text-text">{t("permissions.title")}</label>
							<PermissionEditor
								permissions={formPermissions}
								onChange={setFormPermissions}
								disabled={editingRole ? !editingRole.isCustom : false}
								orgContext={Boolean(orgId)}
							/>
							{editingRole && !editingRole.isCustom && (
								<p className="text-xs text-muted mt-1">{t("permissions.predefinedReadonly")}</p>
							)}
						</div>
						<FormModalFooter onCancel={() => setModalOpen(false)} submitting={submitting} />
					</form>
				</adc-modal>
			)}

			{deleteConfirm && (
				<DeleteConfirmModal
					message={t("roles.deleteConfirm", { name: deleteConfirm.name })}
					onClose={() => setDeleteConfirm(null)}
					onConfirm={handleDelete}
				/>
			)}
		</>
	);
}
