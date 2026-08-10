import { LEGAL_DOCUMENTS, MIN_AGE } from "@common/utils/legal-docs.js";
import { resolvePlatformPath } from "@ui-library/utils/platform-links";
import type { UseTranslationReturn } from "@ui-library/utils/i18n-react";

/** URLs absolutas a los documentos legales, que viven en la app `help` (otro origen). */
export const LEGAL_LINKS = {
	terms: resolvePlatformPath("help", LEGAL_DOCUMENTS.terms.href) ?? LEGAL_DOCUMENTS.terms.href,
	privacy: resolvePlatformPath("help", LEGAL_DOCUMENTS.privacy.href) ?? LEGAL_DOCUMENTS.privacy.href,
	ages: resolvePlatformPath("help", `${LEGAL_DOCUMENTS.terms.href}#edad-minima`) ?? LEGAL_DOCUMENTS.terms.href,
};

interface OAuthLegalNoticeProps {
	readonly t: UseTranslationReturn["t"];
}

/**
 * Clickwrap del alta por OAuth, que no pasa por el formulario con casillas: acompaña a TODOS los
 * botones que arrancan el flujo (Login y Register). El servidor graba la constancia con
 * `via: "oauth"` apoyándose en que siempre fue visible.
 */
export function OAuthLegalNotice({ t }: OAuthLegalNoticeProps) {
	return (
		<p className="mt-4 text-[11px] text-center text-muted leading-relaxed">
			{t("register.oauthLegalBefore", undefined, "Al continuar con Discord o Google aceptás los")}{" "}
			<a href={LEGAL_LINKS.terms} target="_blank" rel="noreferrer" className="text-accent hover:underline">
				{t("register.termsLink", undefined, "Términos y Condiciones")}
			</a>{" "}
			{t("register.acceptTermsBetween", undefined, "y la")}{" "}
			<a href={LEGAL_LINKS.privacy} target="_blank" rel="noreferrer" className="text-accent hover:underline">
				{t("register.privacyLink", undefined, "Política de Privacidad")}
			</a>
			{t("register.oauthLegalAfter", { minAge: String(MIN_AGE) }) ||
				`, y declarás tener al menos ${MIN_AGE} años o la edad mínima que exija tu país.`}
		</p>
	);
}
