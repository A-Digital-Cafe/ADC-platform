import { useTranslation } from "@ui-library/utils/i18n-react";
import { ErrorCard } from "../components/ErrorCard.tsx";
import { readParam } from "../utils/params.ts";

export function GenericErrorPage() {
	const { t, ready } = useTranslation({ namespace: "adc-error", autoLoad: true });
	if (!ready) return <adc-skeleton variant="rectangular" height="300px" />;

	const message = readParam("message") || readParam("error");

	return (
		<ErrorCard
			icon="❗"
			title={t("generic.title")}
			subtitle={t("generic.subtitle")}
			description={message || t("generic.defaultMessage")}
			hint={t("generic.hint")}
			tone="info"
		/>
	);
}
