import React from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";
import { ErrorCard } from "../components/ErrorCard.tsx";
import { readParam } from "../utils/params.ts";

export function BannedPage() {
	const { t, ready } = useTranslation({ namespace: "adc-error", autoLoad: true });
	if (!ready) return <adc-skeleton variant="rectangular" height="360px" />;

	const reason = readParam("reason");
	return (
		<ErrorCard
			icon="🚫"
			title={t("banned.title")}
			subtitle={t("banned.subtitle")}
			description={reason || t("banned.defaultReason")}
			hint={t("banned.hint")}
			tone="danger"
		/>
	);
}
