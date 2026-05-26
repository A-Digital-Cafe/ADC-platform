import { useTranslation } from "@ui-library/utils/i18n-react";

export default function CompatibilityView() {
	const { t } = useTranslation({ namespace: "status-app", autoLoad: true });

	return (
		<adc-page-shell heading={t("compatibility.title")} description={t("compatibility.subtitle")}>
			{/* Browsers compatibility list - readonly for clients, editable for admins */}
			<div>
				<h3 className="font-semibold text-lg text-text mb-4">{t("compatibility.browsers")}</h3>
				<div className="grid gap-3">{/* Backend-backed browser compatibility list placeholder */}</div>
			</div>

			{/* Devices compatibility list - readonly for clients, editable for admins */}
			<div>
				<h3 className="font-semibold text-lg text-text mb-4">{t("compatibility.devices")}</h3>
				<div className="grid gap-3">{/* Backend-backed device compatibility list placeholder */}</div>
			</div>
		</adc-page-shell>
	);
}
