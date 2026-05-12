import React, { useState } from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";
import { router } from "@common/utils/router.js";
import { OrgRequestForm } from "../components/OrgRequestForm.js";
import { OrgRequestSuccess } from "../components/OrgRequestSuccess.js";

/**
 * Vista de solicitud de creación de organización
 * Página standalone que usa OrgRequestForm
 */
export default function OrgRequestView() {
	const { t } = useTranslation({ namespace: "adc-org-management", autoLoad: true });
	const [submitted, setSubmitted] = useState(false);

	// Success handlers
	const handleGoHome = () => {
		router.navigate("/org-management");
	};

	const handleSuccess = () => {
		setSubmitted(true);
	};

	return (
		<div className="min-h-screen bg-background px-4 py-12">
			<div className="max-w-2xl mx-auto">
				{/* Header */}
				<div className="text-center mb-12">
					<h1 className="text-4xl font-bold text-text mb-3">{t("request.title")}</h1>
					<p className="text-lg text-muted">{t("request.subtitle")}</p>
				</div>

				{/* Form Container */}
				<div className="bg-surface rounded-xxl p-8 shadow-sm border border-border">
					{submitted ? (
						<OrgRequestSuccess onGoHome={handleGoHome} />
					) : (
						<div className="space-y-6">
							<OrgRequestForm onSuccess={handleSuccess} />
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
