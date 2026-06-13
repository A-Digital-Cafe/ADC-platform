import { useCallback } from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";

interface DeleteConfirmModalProps {
	readonly message: string;
	readonly onClose: () => void;
	readonly onConfirm: () => void;
}

export function DeleteConfirmModal({ message, onClose, onConfirm }: DeleteConfirmModalProps) {
	const { t } = useTranslation({ namespace: "adc-identity", autoLoad: true });

	const ref = useCallback((el: HTMLElement | null) => {
		if (el) el.addEventListener("adcClose", onClose);
	}, []);

	return (
		<adc-modal ref={ref} open modalTitle={t("common.confirmDelete")} size="sm">
			<p className="text-text">{message}</p>
			<div slot="footer" className="flex justify-end gap-2">
				<adc-button variant="accent-outlined" onClick={onClose}>
					{t("common.cancel")}
				</adc-button>
				<adc-button variant="primary" onClick={onConfirm}>
					{t("common.delete")}
				</adc-button>
			</div>
		</adc-modal>
	);
}
