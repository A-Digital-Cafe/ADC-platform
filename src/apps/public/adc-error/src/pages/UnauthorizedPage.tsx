import { useTranslation } from "@ui-library/utils/i18n-react";
import { ErrorCard } from "../components/ErrorCard.tsx";
import { readParam } from "../utils/params.ts";
import { goToLogin } from "@ui-library/utils/session";
import { isSafeReturnUrl } from "@common/utils/module-availability.js";

/**
 * El kernel manda acá cuando un módulo con `uiModule.access` se pide sin la sesión o los
 * roles que declaró: el bundle nunca salió del servidor.
 *
 * No se dice QUÉ rol faltaba. Quien llega hasta acá puede ser cualquiera, y enumerar los roles
 * que abren un panel de administración es un mapa gratis de la superficie interna.
 */
const REASONS = new Set(["auth", "role", "org", "unavailable"]);

/**
 * El `from` viaja por query string, así que es texto de quien arme el link. Sin este filtro
 * el botón de login lo reenviaría como `returnUrl` y la página sería un open-redirect
 * firmado por el dominio propio.
 */
function safeFrom(): string | undefined {
	const from = readParam("from", 2000);
	return from && isSafeReturnUrl(from) ? from : undefined;
}

export function UnauthorizedPage() {
	const { t, ready } = useTranslation({ namespace: "adc-error", autoLoad: true });
	const raw = readParam("reason");
	const reason = REASONS.has(raw) ? raw : "role";
	const appName = readParam("app", 60);

	if (!ready) return <adc-skeleton variant="rectangular" height="320px" />;

	return (
		<ErrorCard
			icon="🔒"
			title={t("unauthorized.title")}
			subtitle={appName ? t("unauthorized.subtitleApp", { app: appName }) : t("unauthorized.subtitle")}
			description={t(`unauthorized.${reason}`)}
			hint={t("unauthorized.hint")}
			tone={reason === "unavailable" ? "warning" : "info"}
		>
			{reason === "auth" && <adc-button label={t("unauthorized.login")} variant="primary" onClick={() => goToLogin(safeFrom())} />}
		</ErrorCard>
	);
}
