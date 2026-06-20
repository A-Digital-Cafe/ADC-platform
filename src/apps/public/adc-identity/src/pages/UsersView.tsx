import React, { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";
import { identityApi } from "@ui-library/utils/api-identity";
import { moderationApi } from "../utils/moderation-api.ts";
import type { Organization, Permission, Role } from "@common/types/identity/index.d.ts";
import { Scope, canWrite, canUpdate, canDelete } from "../utils/permissions.ts";
import { DataTable, type Column } from "../components/DataTable.tsx";
import { DeleteConfirmModal } from "../components/DeleteConfirmModal.tsx";
import { clearErrors } from "@ui-library/utils/adc-fetch";
import { toast } from "@ui-library/utils/toast";
import { RowActions } from "../components/RowActions.tsx";
import { BanUserModal, UserFormModal } from "../components/UserModals/index.ts";
import { ClientUser } from "@common/types/identity/User.ts";

/** Pattern de username válido: alfanumérico + _ . - entre 3 y 32 caracteres. */
const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,32}$/;

interface UsersViewProps {
	readonly perms: Permission[];
	readonly orgId?: string;
	readonly isAdmin?: boolean;
	readonly isScopedOrgView?: boolean;
	readonly organizations?: Organization[];
}

export function UsersView({ perms, orgId, isAdmin, isScopedOrgView = false, organizations = [] }: UsersViewProps) {
	const { t } = useTranslation({ namespace: "adc-identity", autoLoad: true });
	const [users, setUsers] = useState<ClientUser[]>([]);
	const [filteredUsers, setFilteredUsers] = useState<ClientUser[]>([]);
	const [roles, setRoles] = useState<Role[]>([]);
	const [pickerRoles, setPickerRoles] = useState<Role[]>([]);
	const orgMap = React.useMemo(() => new Map(organizations.map((o) => [o.orgId, o.slug])), [organizations]);
	const [loading, setLoading] = useState(true);
	const [modalOpen, setModalOpen] = useState(false);
	const [editingUser, setEditingUser] = useState<ClientUser | null>(null);
	const [deleteConfirm, setDeleteConfirm] = useState<ClientUser | null>(null);
	const [banTarget, setBanTarget] = useState<ClientUser | null>(null);

	// Form state
	const [formUsername, setFormUsername] = useState("");
	const [formPassword, setFormPassword] = useState("");
	const [formEmail, setFormEmail] = useState("");
	const [formRoleIds, setFormRoleIds] = useState<string[]>([]);
	const [formIsActive, setFormIsActive] = useState(true);
	const [formPermissions, setFormPermissions] = useState<Permission[]>([]);
	const [submitting, setSubmitting] = useState(false);
	const [usernameStatus, setUsernameStatus] = useState<"idle" | "checking" | "available" | "unavailable">("idle");

	const controllerRef = useRef<AbortController | null>(null);

	const writable = canWrite(perms, Scope.USERS);
	const updatable = canUpdate(perms, Scope.USERS);
	const deletable = canDelete(perms, Scope.USERS);

	const checkUsername = async (username: string) => {
		controllerRef.current?.abort();
		if (!USERNAME_PATTERN.test(username)) {
			setUsernameStatus("idle");
			return;
		}

		const controller = new AbortController();
		controllerRef.current = controller;

		try {
			setUsernameStatus("checking");
			const res = await identityApi.checkUsernameExists(username, controller.signal);
			if (res.status === 200) {
				// Usuario existe
				setUsernameStatus(editingUser?.username === username ? "available" : "unavailable");
			} else if (res.status === 404) {
				// Usuario no existe
				setUsernameStatus("available");
			} else {
				setUsernameStatus("idle");
			}
		} catch (err: any) {
			if (err?.name !== "AbortError") {
				setUsernameStatus("idle");
			}
		}
	};

	useEffect(() => {
		// No validar si estamos en vista scopeada por org (no se puede cambiar username al editar)
		if (isScopedOrgView && editingUser) {
			setUsernameStatus("idle");
			return;
		}

		// No validar si el username es el del usuario actual (editando)
		if (formUsername === editingUser?.username) {
			setUsernameStatus("idle");
			return;
		}

		if (formUsername.length < 3) {
			setUsernameStatus("idle");
			return;
		}

		const timeout = setTimeout(() => {
			checkUsername(formUsername);
		}, 500);

		return () => clearTimeout(timeout);
	}, [formUsername, editingUser, isScopedOrgView]);

	const loadData = useCallback(async () => {
		setLoading(true);
		const usersRes = await identityApi.listUsers(orgId);

		if (usersRes.success && usersRes.data) {
			setUsers(usersRes.data.users ?? []);
			setFilteredUsers(usersRes.data.users ?? []);
			setRoles(usersRes.data.roles ?? []);
		}
		setLoading(false);
	}, [orgId]);

	useEffect(() => {
		loadData();
	}, [loadData]);

	const handleSearch = (query: string) => {
		if (!query) {
			setFilteredUsers(users);
			return;
		}
		const q = query.toLowerCase();
		setFilteredUsers(users.filter((u) => u.username.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q)));
	};

	const getVisibleRoleIds = (user: ClientUser): string[] => {
		if (!orgId) return user.roleIds;
		const membership = user.orgMemberships?.find((item) => item.orgId === orgId);
		return Array.from(new Set([...(user.roleIds || []), ...(membership?.roleIds || [])]));
	};

	const getEditableRoleIds = (user: ClientUser): string[] => {
		if (!orgId) return user.roleIds;
		const membership = user.orgMemberships?.find((item) => item.orgId === orgId);
		return membership?.roleIds || [];
	};

	const assignablePickerRoles = React.useMemo(() => {
		if (!orgId || !isScopedOrgView) return pickerRoles;
		return pickerRoles.filter((role) => role.orgId === orgId || formRoleIds.includes(role.id));
	}, [formRoleIds, isScopedOrgView, orgId, pickerRoles]);

	const loadPickerRoles = useCallback(async () => {
		const rolesRes = await identityApi.listRoles(orgId);
		if (rolesRes.success && rolesRes.data) {
			setPickerRoles(rolesRes.data);
		}
	}, [orgId]);

	const openCreateModal = async () => {
		setEditingUser(null);
		setFormUsername("");
		setFormPassword("");
		setFormEmail("");
		setFormRoleIds([]);
		setFormIsActive(true);
		setFormPermissions([]);
		setUsernameStatus("idle");
		await loadPickerRoles();
		setModalOpen(true);
	};

	const openEditModal = async (user: ClientUser) => {
		setEditingUser(user);
		setFormUsername(user.username);
		setFormPassword("");
		setFormEmail(user.email || "");
		setFormRoleIds(getEditableRoleIds(user));
		setFormIsActive(user.isActive);
		setFormPermissions(user.permissions ? [...user.permissions] : []);
		setUsernameStatus("idle");
		await loadPickerRoles();
		setModalOpen(true);
	};

	const handleSubmit = async (e: React.SubmitEvent) => {
		e.preventDefault();
		clearErrors();
		setSubmitting(true);

		if (editingUser) {
			const payload = isScopedOrgView
				? {
						roleIds: formRoleIds,
					}
				: {
						username: formUsername,
						email: formEmail || undefined,
						roleIds: formRoleIds,
						isActive: formIsActive,
						permissions: formPermissions,
					};
			const result = await identityApi.updateUser(editingUser.id, payload, isScopedOrgView ? orgId : undefined);
			if (result.success) {
				setModalOpen(false);
				toast.success(t("common.updated"));
				loadData();
			}
		} else {
			const result = await identityApi.createUser({
				username: formUsername,
				password: formPassword,
				roleIds: formRoleIds,
				orgId,
			});
			if (result.success) {
				setModalOpen(false);
				toast.success(t("common.created"));
				loadData();
			}
		}
		setSubmitting(false);
	};

	const handleDelete = async () => {
		if (!deleteConfirm) return;
		clearErrors();
		const result = await identityApi.deleteUser(deleteConfirm.id, isScopedOrgView ? orgId : undefined);
		if (result.success) {
			setDeleteConfirm(null);
			toast.success(t("common.deleted"));
			loadData();
		}
	};

	const handleUnban = async (user: ClientUser) => {
		clearErrors();
		const result = await moderationApi.unbanUser(user.id);
		if (result.success) loadData();
	};

	const isUserBanned = (user: ClientUser): boolean => !user.isActive && !!user.metadata && !!(user.metadata as any).bannedAt;

	const toggleRoleId = (roleId: string) => {
		setFormRoleIds((prev) => (prev.includes(roleId) ? prev.filter((id) => id !== roleId) : [...prev, roleId]));
	};

	const columns: Column<ClientUser>[] = [
		{ key: "username", label: t("users.username") },
		{ key: "email", label: t("users.email"), render: (u) => u.email || "—" },
		{
			key: "roleIds",
			label: t("users.roles"),
			render: (u) => (
				<div className="flex flex-wrap gap-1">
					{getVisibleRoleIds(u).map((rid) => {
						const role = roles.find((r) => r.id === rid);
						if (!role) {
							return (
								<adc-badge key={rid} color="gray" size="sm" title={t("users.roleMissingHint", { id: rid })}>
									{t("users.roleMissing")}
								</adc-badge>
							);
						}
						return (
							<adc-badge key={rid} color={role.orgId ? "indigo" : "blue"} size="sm">
								{role.name}
							</adc-badge>
						);
					})}
					{getVisibleRoleIds(u).length === 0 && <span className="text-muted text-xs">—</span>}
				</div>
			),
		},
		{
			key: "isActive",
			label: t("users.status"),
			render: (u) =>
				isUserBanned(u) ? (
					<adc-badge color="red" dot>
						{t("users.banned")}
					</adc-badge>
				) : (
					<adc-badge color={u.isActive ? "green" : "red"} dot>
						{u.isActive ? t("users.active") : t("users.inactive")}
					</adc-badge>
				),
		},
		...(isAdmin && !orgId
			? [
					{
						key: "orgMemberships",
						label: t("common.organization"),
						render: (u: ClientUser) => (
							<div className="flex flex-wrap gap-1">
								{u.orgMemberships?.map((m) => (
									<adc-badge key={m.orgId} color="indigo" size="sm">
										{orgMap.get(m.orgId) || m.orgId}
									</adc-badge>
								))}
								{(!u.orgMemberships || u.orgMemberships.length === 0) && <span className="text-muted text-xs">—</span>}
							</div>
						),
					} as Column<ClientUser>,
				]
			: []),
		{
			key: "lastLogin",
			label: t("users.lastLogin"),
			render: (u) => (u.lastLogin ? new Date(u.lastLogin).toLocaleDateString() : "—"),
		},
	];

	return (
		<>
			<DataTable
				columns={columns}
				data={filteredUsers}
				loading={loading}
				searchPlaceholder={t("users.searchPlaceholder")}
				onSearch={handleSearch}
				onAdd={writable ? openCreateModal : undefined}
				addLabel={t("users.addUser")}
				keyExtractor={(u) => u.id}
				emptyMessage={t("users.noUsers")}
				actions={(user) => (
					<RowActions
						item={user}
						canEdit={updatable}
						canDelete={deletable}
						canBan={isAdmin && !orgId && updatable}
						isBanned={isUserBanned(user)}
						onEdit={openEditModal}
						onDelete={setDeleteConfirm}
						onBan={setBanTarget}
						onUnban={handleUnban}
						editLabel={t("common.edit")}
						deleteLabel={t("common.delete")}
						banLabel={t("users.ban")}
						unbanLabel={t("users.unban")}
					/>
				)}
			/>

			{/* Create/Edit Modal */}
			{modalOpen && (
				<UserFormModal
					editingUser={editingUser}
					isScopedOrgView={isScopedOrgView}
					submitting={submitting}
					usernameStatus={usernameStatus}
					assignablePickerRoles={assignablePickerRoles}
					formUsername={formUsername}
					formPassword={formPassword}
					formEmail={formEmail}
					formRoleIds={formRoleIds}
					formIsActive={formIsActive}
					formPermissions={formPermissions}
					onUsernameChange={setFormUsername}
					onPasswordChange={setFormPassword}
					onEmailChange={setFormEmail}
					onActiveChange={setFormIsActive}
					onPermissionsChange={setFormPermissions}
					onToggleRoleId={toggleRoleId}
					onSubmit={handleSubmit}
					onClose={() => setModalOpen(false)}
				/>
			)}

			{deleteConfirm && (
				<DeleteConfirmModal
					message={t("users.deleteConfirm", { name: deleteConfirm.username })}
					onClose={() => setDeleteConfirm(null)}
					onConfirm={handleDelete}
				/>
			)}

			{banTarget && (
				<BanUserModal
					user={banTarget}
					onClose={() => setBanTarget(null)}
					onBanned={() => {
						setBanTarget(null);
						loadData();
					}}
				/>
			)}
		</>
	);
}
