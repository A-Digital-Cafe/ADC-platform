import React, { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";
import { identityApi } from "@ui-library/utils/api-identity";
import { sessionsAdminApi } from "../utils/sessions-api.ts";
import type { Organization, Permission, Role } from "@common/types/identity/index.d.ts";
import { Scope, canWrite, canUpdate, canDelete } from "../utils/permissions.ts";
import { hasPermission } from "@common/utils/perms.ts";
import { CRUDXAction } from "@common/types/Actions";
import { SecurityScopes, SECURITY_RESOURCE_NAME } from "@common/types/security/permissions.ts";
import { DataTable, type Column } from "../components/DataTable.tsx";
import { DeleteConfirmModal } from "../components/DeleteConfirmModal.tsx";
import { clearErrors } from "@ui-library/utils/adc-fetch";
import { toast } from "@ui-library/utils/toast";
import { BanUserModal, UserFormModal } from "../components/UserModals/index.ts";
import { UnbanModal } from "../components/UnbanModal.tsx";
import { ClientUser } from "@common/types/identity/User.ts";
import type { ContextMenuItem } from "@ui-library/utils/react-jsx";

/** Pattern de username válido: alfanumérico + _ . - entre 3 y 32 caracteres. */
const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,32}$/;

/** Tamaño de página del listado (server-side: el endpoint devuelve la página + total). */
const PAGE_SIZE = 10;

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
	const [roles, setRoles] = useState<Role[]>([]);
	const [pickerRoles, setPickerRoles] = useState<Role[]>([]);
	const orgMap = React.useMemo(() => new Map(organizations.map((o) => [o.orgId, o.slug])), [organizations]);
	// Paginación server-side: el endpoint devuelve la página + total (la colección puede superar el cap del server).
	const [pageIndex, setPageIndex] = useState(1);
	const [total, setTotal] = useState(0);
	const [searchQuery, setSearchQuery] = useState("");
	// Sólo el primer fetch muestra skeleton: los cambios de página/búsqueda mantienen la tabla montada.
	const [initialLoading, setInitialLoading] = useState(true);
	const [modalOpen, setModalOpen] = useState(false);
	const [editingUser, setEditingUser] = useState<ClientUser | null>(null);
	const [deleteConfirm, setDeleteConfirm] = useState<ClientUser | null>(null);
	const [banTarget, setBanTarget] = useState<ClientUser | null>(null);
	const [unbanTarget, setUnbanTarget] = useState<ClientUser | null>(null);
	// Menú contextual "⋮" por fila (acciones sensibles: ban, sesiones, eliminar)
	const [contextMenu, setContextMenu] = useState<{ open: boolean; x: number; y: number; user: ClientUser | null }>({
		open: false,
		x: 0,
		y: 0,
		user: null,
	});

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
	// Force logout (security.sessions): recurso global-only, sólo en contexto global.
	const canRevokeSessions = !orgId && hasPermission(perms, SECURITY_RESOURCE_NAME, CRUDXAction.DELETE, SecurityScopes.SESSIONS);
	const [revokeTarget, setRevokeTarget] = useState<ClientUser | null>(null);

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
		const q = searchQuery.trim().length >= 2 ? searchQuery.trim() : undefined;
		const usersRes = await identityApi.listUsers({ orgId, q, limit: PAGE_SIZE, offset: (pageIndex - 1) * PAGE_SIZE });

		if (usersRes.success && usersRes.data) {
			const items = usersRes.data.users ?? [];
			setUsers(items);
			setRoles(usersRes.data.roles ?? []);
			setTotal(usersRes.data.total ?? items.length);
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
		// El picker necesita el set completo de roles asignables (hasta el cap del server).
		const rolesRes = await identityApi.listRoles({ orgId, limit: 500 });
		if (rolesRes.success && rolesRes.data) {
			setPickerRoles(rolesRes.data.roles ?? []);
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

	const handleRevokeSessions = async () => {
		if (!revokeTarget) return;
		clearErrors();
		const result = await sessionsAdminApi.revoke(revokeTarget.id);
		setRevokeTarget(null);
		if (result.ok) toast.success(t("users.sessionsRevoked", { count: String(result.revoked) }));
	};

	const isUserBanned = (user: ClientUser): boolean => !user.isActive && !!user.metadata && !!(user.metadata as any).bannedAt;

	// ── Menú contextual "⋮" (acciones sensibles fuera del alcance de un mis-click) ──
	const canModerate = !!isAdmin && !orgId && updatable;

	const buildMenuItems = (user: ClientUser): ContextMenuItem[] => [
		...(canModerate
			? [
					isUserBanned(user)
						? { label: t("users.unban"), action: "unban" }
						: { label: t("users.ban"), action: "ban", danger: true },
				]
			: []),
		...(canRevokeSessions ? [{ label: t("users.revokeSessions"), action: "revoke-sessions", danger: true }] : []),
		...(deletable ? [{ label: t("common.delete"), action: "delete", danger: true }] : []),
	];

	const hasMenuActions = canModerate || canRevokeSessions || deletable;

	const openContextMenu = (user: ClientUser, x: number, y: number) => setContextMenu({ open: true, x, y, user });

	const handleMenuSelect = (action: string) => {
		const user = contextMenu.user;
		setContextMenu((m) => ({ ...m, open: false }));
		if (!user) return;
		if (action === "ban") setBanTarget(user);
		else if (action === "unban") setUnbanTarget(user);
		else if (action === "revoke-sessions") setRevokeTarget(user);
		else if (action === "delete") setDeleteConfirm(user);
	};

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
				data={users}
				loading={initialLoading}
				pageSize={PAGE_SIZE}
				total={total}
				page={pageIndex}
				onPageChange={setPageIndex}
				searchDebounce={300}
				searchPlaceholder={t("users.searchPlaceholder")}
				onSearch={handleSearch}
				onAdd={writable ? openCreateModal : undefined}
				addLabel={t("users.addUser")}
				keyExtractor={(u) => u.id}
				emptyMessage={t("users.noUsers")}
				actions={(user) => (
					<div className="flex items-center gap-1">
						{updatable && (
							<adc-button-rounded aria-label={t("common.edit")} onClick={() => openEditModal(user)}>
								<adc-icon-edit />
							</adc-button-rounded>
						)}
						{hasMenuActions && (
							<adc-button-rounded
								aria-label={t("users.moreActions")}
								title={t("users.moreActions")}
								onClick={(e: React.MouseEvent) => {
									e.stopPropagation();
									openContextMenu(user, e.clientX, e.clientY);
								}}
							>
								<adc-icon-dots-vertical size="1.15rem" />
							</adc-button-rounded>
						)}
					</div>
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

			{unbanTarget && (
				<UnbanModal
					target={{ userId: unbanTarget.id }}
					targetLabel={unbanTarget.username}
					onClose={() => setUnbanTarget(null)}
					onUnbanned={() => {
						setUnbanTarget(null);
						loadData();
					}}
				/>
			)}

			{/* Menú contextual "⋮": ban/unban, cerrar sesiones y eliminar */}
			<adc-context-menu
				open={contextMenu.open}
				x={contextMenu.x}
				y={contextMenu.y}
				items={contextMenu.user ? buildMenuItems(contextMenu.user) : []}
				onadcContextMenuClose={() => setContextMenu((m) => ({ ...m, open: false }))}
				onadcContextMenuSelect={(ev: CustomEvent<{ action: string }>) => handleMenuSelect(ev.detail.action)}
			/>

			{revokeTarget && (
				<DeleteConfirmModal
					message={t("users.revokeSessionsConfirm", { name: revokeTarget.username })}
					onClose={() => setRevokeTarget(null)}
					onConfirm={handleRevokeSessions}
				/>
			)}
		</>
	);
}
