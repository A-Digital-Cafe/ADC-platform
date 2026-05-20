import { useTranslation } from "@ui-library/utils/i18n-react";

export default function MetricsView() {
	const { t } = useTranslation({ namespace: "status-app", autoLoad: true });

	return (
		<div className="w-full flex flex-col pl-25 lg:pl-70">
			<div className="mb-6">
				<h2 className="font-heading text-2xl font-bold text-text mb-2">{t("metrics.title")}</h2>
				<p className="text-muted">{t("metrics.subtitle")}</p>
			</div>

			{/* Performance metrics from Google PageSpeed Insights will be rendered here */}
			<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
				{/* TODO: Fetch metrics from backend (integrated with Google PageSpeed API) */}
			</div>
		</div>
	);}