import { useTranslation } from "@ui-library/utils/i18n-react";
import CreateTicketForm from "../components/CreateTicketForm";

export default function TicketsView() {
	const { t } = useTranslation({ namespace: "status-app", autoLoad: true });

	return (
		<adc-page-shell heading={t("tickets.title")} description={t("tickets.subtitle")}>
			<CreateTicketForm />
		</adc-page-shell>
	);
}
