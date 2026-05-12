import { useTranslation } from "@ui-library/utils/i18n-react";

interface FormModalFooterProps {
	readonly onCancel: () => void;
	readonly submitting: boolean;
}

export function FormModalFooter({ onCancel, submitting }: FormModalFooterProps) {
	const { t } = useTranslation({ namespace: "adc-identity", autoLoad: true });

	return (
		<div slot="footer" className="flex justify-end gap-2">
			<adc-button variant="accent" type="button" onClick={onCancel}>
				{t("common.cancel")}
			</adc-button>
			<adc-button variant="primary" type="submit" disabled={submitting}>
				{submitting ? t("common.saving") : t("common.save")}
			</adc-button>
		</div>
	);
}
