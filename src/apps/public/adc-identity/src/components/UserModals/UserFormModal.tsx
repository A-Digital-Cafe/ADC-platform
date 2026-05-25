import React, { useCallback } from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";
import { FormModalFooter } from "../FormModalFooter.tsx";
import { RolePicker } from "../RolePicker.tsx";
import { PermissionEditor } from "../PermissionEditor/index.ts";
import type { ClientUser, Permission, Role } from "@common/types/identity/index.d.ts";

export type UsernameStatus = "idle" | "checking" | "available" | "unavailable";

interface UserFormModalProps {
	readonly editingUser: ClientUser | null;
	readonly isScopedOrgView: boolean;
	readonly submitting: boolean;
	readonly usernameStatus: UsernameStatus;
	readonly assignablePickerRoles: Role[];

	readonly formUsername: string;
	readonly formPassword: string;
	readonly formEmail: string;
	readonly formRoleIds: string[];
	readonly formIsActive: boolean;
	readonly formPermissions: Permission[];

	readonly onUsernameChange: (value: string) => void;
	readonly onPasswordChange: (value: string) => void;
	readonly onEmailChange: (value: string) => void;
	readonly onActiveChange: (value: boolean) => void;
	readonly onPermissionsChange: (perms: Permission[]) => void;
	readonly onToggleRoleId: (roleId: string) => void;

	readonly onSubmit: (e: React.SubmitEvent) => void;
	readonly onClose: () => void;
}

/** Modal para crear/editar un usuario. */
export function UserFormModal(props: UserFormModalProps) {
	const {
		editingUser,
		isScopedOrgView,
		submitting,
		usernameStatus,
		assignablePickerRoles,
		formUsername,
		formPassword,
		formEmail,
		formRoleIds,
		formIsActive,
		formPermissions,
		onUsernameChange,
		onPasswordChange,
		onEmailChange,
		onActiveChange,
		onPermissionsChange,
		onToggleRoleId,
		onSubmit,
		onClose,
	} = props;
	const { t } = useTranslation({ namespace: "adc-identity", autoLoad: true });

	const modalRef = useCallback(
		(el: HTMLElement | null) => {
			if (el) el.addEventListener("adcClose", onClose);
		},
		[onClose]
	);
	const toggleRef = useCallback(
		(el: HTMLElement | null) => {
			if (el) el.addEventListener("adcChange", (e: Event) => onActiveChange((e as CustomEvent<boolean>).detail));
		},
		[onActiveChange]
	);

	return (
		<adc-modal ref={modalRef} open modalTitle={editingUser ? t("users.editUser") : t("users.addUser")} size="lg">
			<form onSubmit={onSubmit} className="space-y-4">
				{(!isScopedOrgView || !editingUser) && (
					<div>
						<label className="block text-sm font-medium mb-1 text-text">{t("users.username")}</label>
						<adc-input
							inputId="username"
							value={formUsername}
							placeholder={t("users.usernamePlaceholder")}
							onInput={(e: any) => onUsernameChange(e.target.value)}
						/>
						{!isScopedOrgView && (
							<>
								{usernameStatus === "checking" && <p className="text-xs text-muted mt-1">Verificando...</p>}
								{usernameStatus === "available" && <p className="text-xs text-green-500 mt-1">Nombre de usuario disponible</p>}
								{usernameStatus === "unavailable" && (
									<p className="text-xs text-red-500 mt-1">Este nombre de usuario ya está en uso</p>
								)}
							</>
						)}
					</div>
				)}

				{!editingUser && (
					<div>
						<label className="block text-sm font-medium mb-1 text-text">{t("users.password")}</label>
						<adc-input
							inputId="password"
							type="password"
							value={formPassword}
							placeholder="••••••••"
							onInput={(e: any) => onPasswordChange(e.target.value)}
						/>
					</div>
				)}

				{!isScopedOrgView && (
					<div>
						<label className="block text-sm font-medium mb-1 text-text">{t("users.email")}</label>
						<adc-input
							inputId="email"
							type="email"
							value={formEmail}
							placeholder="user@example.com"
							onInput={(e: any) => onEmailChange(e.target.value)}
						/>
					</div>
				)}

				{editingUser && !isScopedOrgView && (
					<div>
						<label className="block text-sm font-medium mb-1 text-text">{t("users.status")}</label>
						<adc-toggle ref={toggleRef} checked={formIsActive} label={formIsActive ? t("users.active") : t("users.inactive")} />
					</div>
				)}

				<div>
					<label className="block text-sm font-medium mb-1 text-text">{t("users.roles")}</label>
					<RolePicker roles={assignablePickerRoles} selectedIds={formRoleIds} onToggle={onToggleRoleId} />
				</div>

				{editingUser && !isScopedOrgView && (
					<div>
						<label className="block text-sm font-medium mb-1 text-text">{t("permissions.directTitle")}</label>
						<p className="text-xs text-muted mb-2">{t("permissions.directHint")}</p>
						<PermissionEditor permissions={formPermissions} onChange={onPermissionsChange} />
					</div>
				)}

				<FormModalFooter onCancel={onClose} submitting={submitting} />
			</form>
		</adc-modal>
	);
}
