import { useTranslation } from "@ui-library/utils/i18n-react";
import CreateTicketForm from "../components/CreateTicketForm";

export default function TicketsView() {
	const { t } = useTranslation({ namespace: "status-app", autoLoad: true });

	return (
		<div className="w-full flex flex-col pl-25 lg:pl-70">
			<div className="mb-6">
				<h2 className="font-heading text-2xl font-bold text-text mb-2">{t("tickets.title")}</h2>
				<p className="text-muted">{t("tickets.subtitle")}</p>
			</div>

			<CreateTicketForm />
		</div>
	);
}
