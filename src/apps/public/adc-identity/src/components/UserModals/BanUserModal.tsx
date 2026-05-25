import React, { useCallback, useState } from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";
import { clearErrors } from "@ui-library/utils/adc-fetch";
import { moderationApi } from "../../utils/moderation-api.ts";
import { FormModalFooter } from "../FormModalFooter.tsx";
import type { ClientUser } from "@common/types/identity/User.ts";

interface BanUserModalProps {
	readonly user: ClientUser;
	readonly onClose: () => void;
	readonly onBanned: () => void;
}

/** Modal para banear un usuario (motivo + expiración opcional). */
export function BanUserModal({ user, onClose, onBanned }: BanUserModalProps) {
	const { t } = useTranslation({ namespace: "adc-identity", autoLoad: true });
	const [reason, setReason] = useState("");
	const [expiresAt, setExpiresAt] = useState("");
	const [submitting, setSubmitting] = useState(false);

	const modalRef = useCallback(
		(el: HTMLElement | null) => {
			if (el) el.addEventListener("adcClose", onClose);
		},
		[onClose]
	);

	const handleSubmit = async (e: React.SubmitEvent) => {
		e.preventDefault();
		clearErrors();
		setSubmitting(true);
		const result = await moderationApi.banUser(user.id, {
			reason,
			expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
		});
		setSubmitting(false);
		if (result.success) onBanned();
	};

	return (
		<adc-modal ref={modalRef} open modalTitle={t("users.banUser", { name: user.username })} size="md">
			<form onSubmit={handleSubmit} className="space-y-4">
				<div>
					<label className="block text-sm font-medium mb-1 text-text">{t("users.banReason")}</label>
					<adc-input type="text" value={reason} required minlength={3} onInput={(e: any) => setReason(e.target.value)} />
				</div>
				<div>
					<label className="block text-sm font-medium mb-1 text-text">{t("users.banExpiresAt")}</label>
					<input
						type="datetime-local"
						className="w-full rounded-md border border-divider bg-surface px-3 py-2 text-text"
						value={expiresAt}
						onChange={(e) => setExpiresAt(e.target.value)}
					/>
					<p className="text-xs text-muted mt-1">{t("users.banExpiresAtHelp")}</p>
				</div>
				<FormModalFooter onCancel={onClose} submitting={submitting} />
			</form>
		</adc-modal>
	);
}
