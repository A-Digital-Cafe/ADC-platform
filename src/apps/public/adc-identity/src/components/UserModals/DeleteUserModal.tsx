import { useCallback, useState } from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";
import { identityApi } from "@ui-library/utils/api-identity";
import { clearErrors } from "@ui-library/utils/adc-fetch";
import { toast } from "@ui-library/utils/toast";
import type { ClientUser } from "@common/types/identity/User.ts";

interface DeleteUserModalProps {
	readonly user: ClientUser;
	/** Organización del contexto: si viene, el DELETE sólo quita la membresía. */
	readonly orgId?: string;
	readonly onClose: () => void;
	readonly onDeleted: () => void;
}

/**
 * Baja de un usuario desde el panel. Propio de esta vista (y no el `DeleteConfirmModal` compartido,
 * que usan otras seis pantallas) porque el mismo endpoint significa dos cosas distintas: en contexto
 * de organización quita la membresía y nada más; en global programa la baja a 30 días con la cascada
 * de purga, revertible reactivando la cuenta.
 *
 * `immediate` es un opt-in desmarcado: adelanta la cascada y a partir de ahí no hay vuelta. No se
 * promete atomicidad a propósito — el backend loguea el fallo de un paso y deja que el cron de 6 h
 * lo retome, así que "ya mismo" puede terminar de completarse después.
 */
export function DeleteUserModal({ user, orgId, onClose, onDeleted }: DeleteUserModalProps) {
	const { t } = useTranslation({ namespace: "adc-identity", autoLoad: true });
	const [immediate, setImmediate] = useState(false);
	const [submitting, setSubmitting] = useState(false);

	const modalRef = useCallback(
		(el: HTMLElement | null) => {
			if (el) el.addEventListener("adcClose", onClose);
		},
		[onClose]
	);

	const handleConfirm = async () => {
		clearErrors();
		setSubmitting(true);
		const result = await identityApi.deleteUser(user.id, orgId, orgId ? undefined : immediate);
		setSubmitting(false);
		if (result.success) {
			onDeleted();
			return;
		}
		// La baja administrativa es fail-closed contra el audit log: sin él no se ejecuta, y decirlo
		// evita que se lea como un error transitorio cualquiera. El resto cae en el genérico: esta
		// vista no monta `adc-custom-error`, así que sin toast el fallo sería invisible.
		toast.error(result.errorKey === "AUDIT_UNAVAILABLE" ? t("users.deleteAuditUnavailable") : t("users.deleteError"));
	};

	return (
		<adc-modal ref={modalRef} open modalTitle={t("users.deleteTitle", { name: user.username })} size="sm">
			<p className="text-text">{orgId ? t("users.deleteOrgBody", { name: user.username }) : t("users.deleteGlobalBody")}</p>

			{!orgId && (
				<label className="mt-4 flex items-start gap-2 cursor-pointer">
					<input
						type="checkbox"
						checked={immediate}
						className="mt-0.5 w-4 h-4 shrink-0 accent-primary cursor-pointer"
						onChange={(e) => setImmediate((e.target as HTMLInputElement).checked)}
					/>
					<span className="text-sm text-text">
						{t("users.deleteImmediate")}
						<span className="block text-xs text-danger mt-0.5">{t("users.deleteImmediateWarning")}</span>
					</span>
				</label>
			)}

			<div slot="footer" className="flex justify-end gap-2">
				<adc-button variant="accent-outlined" onClick={onClose}>
					{t("common.cancel")}
				</adc-button>
				<adc-button variant="primary" disabled={submitting} onClick={handleConfirm}>
					{t("common.delete")}
				</adc-button>
			</div>
		</adc-modal>
	);
}
