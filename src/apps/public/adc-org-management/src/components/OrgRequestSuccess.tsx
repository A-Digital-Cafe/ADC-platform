import { useTranslation } from "@ui-library/utils/i18n-react";

interface OrgRequestSuccessProps {
	readonly onGoHome: () => void;
}

export function OrgRequestSuccess({ onGoHome }: OrgRequestSuccessProps) {
	const { t } = useTranslation({ namespace: "adc-org-management", autoLoad: true });

	return (
		<div className="flex flex-col items-center justify-center py-4">
			<div className="w-16 h-16 rounded-full bg-success flex items-center justify-center mb-4">
				<svg className="w-8 h-8 text-tsuccess" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
				</svg>
			</div>
			<h2 className="text-2xl font-bold text-text mb-2">{t("request.successTitle")}</h2>
			<p className="text-center text-muted mb-6 max-w-md">{t("request.successMessage")}</p>
			<div className="bg-info border border-success/20 rounded-lg p-4 mb-8 w-full">
				<div className="text-sm text-tinfo">
					<p className="font-semibold mb-3">{t("request.successWhat")}</p>
					<ul className="space-y-2 text-xs">
						<li className="flex gap-2">
							<span className="text-tsuccess">✓</span>
							<span>{t("request.successItems.0")}</span>
						</li>
						<li className="flex gap-2">
							<span className="text-tsuccess">✓</span>
							<span>{t("request.successItems.1")}</span>
						</li>
					</ul>
				</div>
			</div>

			<div className="flex gap-3 w-full justify-center">
				<adc-button type="button" onClick={onGoHome} variant="primary">
					{t("request.goHome")}
				</adc-button>
			</div>
		</div>
	);
}
