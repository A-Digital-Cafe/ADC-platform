import { useTranslation } from "@ui-library/utils/i18n-react";

export function LandingView() {
	const { t } = useTranslation({ namespace: "adc-identity", autoLoad: true });

	const features = [
		{ key: "users", icon: <adc-icon-community size="2rem" /> },
		{ key: "roles", icon: <adc-icon-learning size="2rem" /> },
		{ key: "groups", icon: <adc-icon-members size="2rem" /> },
	] as const;

	return (
		<div className="max-w-6xl mx-auto px-4 py-12">
			<section className="flex flex-col items-center text-center" aria-label={t("landing.heroAria")}>
				<div className="bg-surface rounded-full p-6 mb-6">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						fill="currentColor"
						width="45"
						height="45"
						viewBox="0 0 24 24"
						className="text-accent/80"
					>
						<path d="M16.03,18.616l5.294-4.853a1,1,0,0,1,1.352,1.474l-6,5.5a1,1,0,0,1-1.383-.03l-3-3a1,1,0,0,1,1.414-1.414ZM1,20a9.01,9.01,0,0,1,5.623-8.337A4.981,4.981,0,1,1,10,13a7.011,7.011,0,0,0-6.929,6H10a1,1,0,0,1,0,2H2A1,1,0,0,1,1,20ZM7,8a3,3,0,1,0,3-3A3,3,0,0,0,7,8Z" />
					</svg>
				</div>
				<h1 className="text-3xl sm:text-4xl font-heading font-bold text-text mb-4">{t("landing.heroTitle")}</h1>
				<p className="text-muted max-w-2xl mb-6">{t("landing.heroSubtitle")}</p>
			</section>

			<section className="w-full flex items-center justify-center gap-10 mt-12" aria-label={t("landing.featuresAria")}>
				{features.map(({ key, icon }) => (
					<adc-feature-card key={key} title={t(`landing.features.${key}.title`)}>
						<span slot="icon" aria-hidden="true" className="text-tsurface">
							{icon}
						</span>
					</adc-feature-card>
				))}
			</section>

			<div className="mt-16 bg-info rounded-lg p-2" aria-label={t("landing.howAria")}>
				<p className="text-center text-lg text-muted text-tinfo/80">{t("landing.signInHint")}</p>
			</div>
		</div>
	);
}
