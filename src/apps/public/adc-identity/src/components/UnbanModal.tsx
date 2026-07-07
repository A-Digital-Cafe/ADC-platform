import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";
import { clearErrors } from "@ui-library/utils/adc-fetch";
import { moderationApi } from "../utils/moderation-api.ts";
import { FormModalFooter } from "./FormModalFooter.tsx";

/** Objetivo del unban: usuario de plataforma o referencia externa (source + externalId). */
export type UnbanTarget = { userId: string } | { source: string; externalId: string };

interface UnbanModalProps {
	readonly target: UnbanTarget;
	/** Etiqueta legible del objetivo (username, máscara de email, etc.) para el título. */
	readonly targetLabel: string;
	readonly onClose: () => void;
	readonly onUnbanned: () => void;
}

/**
 * Modal para levantar un ban con motivo opcional.
 * La clave de idempotencia se genera POR INTENTO (al montar el modal): levantar bans
 * repetidos del mismo usuario es legítimo, así que no se deriva de los datos.
 */
export function UnbanModal({ target, targetLabel, onClose, onUnbanned }: UnbanModalProps) {
	const { t } = useTranslation({ namespace: "adc-identity", autoLoad: true });
	const [reason, setReason] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const intentKey = useMemo(() => crypto.randomUUID(), []);

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
		const trimmed = reason.trim() || undefined;
		const result =
			"userId" in target
				? await moderationApi.unbanUser(target.userId, trimmed, intentKey)
				: await moderationApi.unbanByExternal(target.source, target.externalId, trimmed, intentKey);
		setSubmitting(false);
		if (result.success) onUnbanned();
	};

	return (
		<adc-modal ref={modalRef} open modalTitle={t("moderation.unbanTitle", { name: targetLabel })} size="md">
			<form onSubmit={handleSubmit} className="space-y-4">
				<div>
					<label className="block text-sm font-medium mb-1 text-text">{t("moderation.unbanReason")}</label>
					<adc-input
						type="text"
						value={reason}
						placeholder={t("moderation.unbanReasonPlaceholder")}
						onInput={(e: any) => setReason(e.target.value)}
					/>
					<p className="text-xs text-muted mt-1">{t("moderation.unbanReasonHint")}</p>
				</div>
				<FormModalFooter onCancel={onClose} submitting={submitting} />
			</form>
		</adc-modal>
	);
}
