import { useTranslation } from "@ui-library/utils/i18n-react";

interface TicketSuccessProps {
	readonly onGoBack: () => void;
}

export function TicketSuccess({ onGoBack }: TicketSuccessProps) {
	const { t } = useTranslation({ namespace: "status-app", autoLoad: true });

	return (
		<div className="border border-border rounded-lg p-6 bg-surface text-center">
			<h3 className="font-semibold text-lg text-text mb-2">{t("tickets.successTitle") || "Ticket Created"}</h3>
			<p className="text-muted mb-4">{t("tickets.successMessage") || "Thank you for your submission."}</p>
			<button onClick={onGoBack} className="px-4 py-2 bg-primary text-tprimary rounded-lg font-medium hover:opacity-90 transition-opacity">
				{t("common.goBack") || "Go Back"}
			</button>
		</div>
	);
}
