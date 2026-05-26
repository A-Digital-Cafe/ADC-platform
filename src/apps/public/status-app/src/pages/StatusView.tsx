import { useTranslation } from "@ui-library/utils/i18n-react";

export default function StatusView() {
	const { t } = useTranslation({ namespace: "status-app", autoLoad: true });

	return (
		<adc-page-shell heading={t("status.title")} description={t("status.subtitle")}>
			{/* Services list will be rendered here */}
			<div className="grid gap-4"></div>
		</adc-page-shell>
	);
}
