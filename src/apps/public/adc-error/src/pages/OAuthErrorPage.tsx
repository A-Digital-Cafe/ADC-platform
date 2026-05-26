import { useTranslation } from "@ui-library/utils/i18n-react";
import { ErrorCard } from "../components/ErrorCard.tsx";
import { readParam } from "../utils/params.ts";

const ALLOWED_PROVIDERS = new Set(["discord", "google", "github", "platform"]);

export function OAuthErrorPage() {
	const { t, ready } = useTranslation({ namespace: "adc-error", autoLoad: true });
	if (!ready) return <adc-skeleton variant="rectangular" height="340px" />;

	const rawProvider = readParam("provider", 32).toLowerCase();
	const provider = ALLOWED_PROVIDERS.has(rawProvider) ? rawProvider : "";
	const message = readParam("message");

	return (
		<ErrorCard
			icon="⚠️"
			title={t("oauth.title")}
			subtitle={provider ? t("oauth.subtitleProvider", { provider }) : t("oauth.subtitle")}
			description={message || t("oauth.defaultMessage")}
			hint={t("oauth.hint")}
			tone="warning"
		/>
	);
}
