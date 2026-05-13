import { useTranslation } from "@ui-library/utils/i18n-react";
import { OrgRequestForm } from "../components/OrgRequestForm.js";

/**
 * Vista home - Formulario para solicitar nueva organización
 */
export default function HomeView() {
	const { t } = useTranslation({ namespace: "adc-org-management", autoLoad: true });

	return (
		<div className="min-h-screen bg-background px-4 py-12">
			<div className="max-w-3xl mx-auto">
				{/* Header */}
				<div className="mb-12">
					<h1 className="text-4xl font-bold text-text mb-3">{t("request.title") || "Mis Organizaciones"}</h1>
					<p className="text-lg text-muted">{t("request.subtitle") || "Gestiona y configura tus organizaciones en ADC Platform"}</p>
				</div>

				{/* Request Form */}
				<div className="mb-12 p-8 bg-surface rounded-xxl border border-border shadow-sm">
					<OrgRequestForm />
				</div>
			</div>
		</div>
	);
}
