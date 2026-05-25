import React from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";
import { ErrorCard } from "../components/ErrorCard.tsx";

export function CsrfPage() {
	const { t, ready } = useTranslation({ namespace: "adc-error", autoLoad: true });
	if (!ready) return <adc-skeleton variant="rectangular" height="320px" />;

	return (
		<ErrorCard
			icon="🛡️"
			title={t("csrf.title")}
			subtitle={t("csrf.subtitle")}
			description={t("csrf.description")}
			hint={t("csrf.hint")}
			tone="warning"
		/>
	);
}
