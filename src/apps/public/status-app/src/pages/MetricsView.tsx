import { useTranslation } from "@ui-library/utils/i18n-react";

export default function MetricsView() {
	const { t } = useTranslation({ namespace: "status-app", autoLoad: true });

	return (
		<adc-page-shell heading={t("metrics.title")} description={t("metrics.subtitle")}>
			{/* Performance metrics from Google PageSpeed Insights will be rendered here */}
			<div className="grid grid-cols-1 md:grid-cols-2 gap-4">{/* Backend-backed Google PageSpeed metrics placeholder */}</div>
		</adc-page-shell>
	);
}
