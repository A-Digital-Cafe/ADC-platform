import "@ui-library/utils/react-jsx";
import { useTranslation } from "@ui-library/utils/i18n-react";


export default function LandingView() {
	const { t } = useTranslation({ namespace: "adc-org-management", autoLoad: true });

	const benefits = [
		{
			number: "1",
			title: t("landing.steps.request.title"),
			description: t("landing.steps.request.description"),
		},
		{
			number: "2",
			title: t("landing.steps.review.title"),
			description: t("landing.steps.review.description"),
		},
		{
			number: "3",
			title: t("landing.steps.manage.title"),
			description: t("landing.steps.manage.description"),
		},
	];

	return (
		<div className="max-w-6xl mx-auto px-4 py-12">
			{/* Hero Section */}
			<div className="max-w-4xl mx-auto px-4 text-center">
			<h1 className="text-5xl sm:text-6xl font-bold text-text mb-6">{t("landing.heroTitle")}</h1>
				<p className="text-lg text-muted/80 max-w-2xl mx-auto mb-12">{t("landing.heroDescription")}</p>
			</div>

			{/* Process Steps */}
<div className="max-w-5xl mx-auto px-4 flex flex-col justify-center items-center gap-6">
			<h2 className="text-3xl font-bold text-text text-center mb-6">{t("landing.processTitle")}</h2>

				<div className="grid grid-cols-1 md:grid-cols-3 gap-8">
					{benefits.map((benefit) => (
						<div key={benefit.number} className="flex flex-col items-center text-center">
							<div className="w-16 h-16 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center mb-4">
								<span className="text-2xl font-bold text-accent">{benefit.number}</span>
							</div>
							<h3 className="text-xl font-semibold text-text mb-3">{benefit.title}</h3>
							<p className="text-muted leading-relaxed">{benefit.description}</p>
						</div>
					))}
				</div>
			</div>

			{/* CTA Section */}

			<div className="mt-16 bg-info rounded-lg p-2 mb-10">
				<p className="text-center text-lg text-muted text-tinfo/80">{t("landing.readyDescription")}</p>
			</div>
			<adc-divider />

			{/* Footer Info */}
			<div className="max-w-3xl mx-auto px-4 p-4 text-center text-muted text-sm">
				<p>{t("landing.footerInfo")}</p>
			</div>
		</div>
	);
}
