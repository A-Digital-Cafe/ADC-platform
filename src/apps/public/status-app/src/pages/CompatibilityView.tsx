import { useTranslation } from "@ui-library/utils/i18n-react";

export default function CompatibilityView() {
	const { t } = useTranslation({ namespace: "status-app", autoLoad: true });

	return (
		<div className="w-full flex flex-col pl-25 lg:pl-70">
			<div className="mb-6">
				<h2 className="font-heading text-2xl font-bold text-text mb-2">{t("compatibility.title")}</h2>
				<p className="text-muted">{t("compatibility.subtitle")}</p>
			</div>

			{/* Browsers compatibility list - readonly for clients, editable for admins */}
			<div>
				<h3 className="font-semibold text-lg text-text mb-4">{t("compatibility.browsers")}</h3>
				<div className="grid gap-3">
					{/* TODO: Fetch browsers from backend and render compatibility list */}
				</div>
			</div>

			{/* Devices compatibility list - readonly for clients, editable for admins */}
			<div>
				<h3 className="font-semibold text-lg text-text mb-4">{t("compatibility.devices")}</h3>
				<div className="grid gap-3">
					{/* TODO: Fetch devices from backend and render compatibility list */}
				</div>
			</div>
		</div>
	);
}
