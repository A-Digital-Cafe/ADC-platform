import { useTheme } from "../hooks/useTheme";
import { useTranslation } from "@ui-library/utils/i18n-react";

export default function AppearanceView() {
	const { t } = useTranslation({ namespace: "my-account", autoLoad: true });
	const { mode, changeTheme } = useTheme();

	const themes = [
		{
			key: "light",
			label: t("appearance.lightLabel"),
			description: t("appearance.lightDescription"),
			icon: (
				<svg className="w-6 h-6 text-text" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<circle cx="12" cy="12" r="4" strokeWidth="2" />
					<path
						strokeWidth="2"
						strokeLinecap="round"
						d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
					/>
				</svg>
			),
		},
		{
			key: "dark",
			label: t("appearance.darkLabel"),
			description: t("appearance.darkDescription"),
			icon: (
				<svg className="w-6 h-6 text-text" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
				</svg>
			),
		},
	] as const;

	return (
		<adc-page-shell heading={t("appearance.title")} description={t("appearance.subtitle")} headerSpacing="sm">
			<adc-section-panel heading={t("appearance.panelTitle")} description={t("appearance.panelDescription")}>
				<div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
					{themes.map((theme) => {
						const isActive = mode === theme.key;

						return (
							<button
								key={theme.key}
								onClick={() => changeTheme(theme.key)}
								className={`
									relative bg-background rounded-xl p-6 flex flex-col items-center transition
									${isActive ? "border-2 border-primary" : "border border-border hover:border-primary"}
								`}
							>
								<div className="w-12 h-12 rounded-full flex items-center justify-center mb-3 bg-surface border border-border">
									{theme.icon}
								</div>

								<span className="font-medium text-text">{theme.label}</span>

								<span className="text-sm text-muted text-center">{theme.description}</span>

								{isActive && (
									<div className="absolute top-3 right-3 w-5 h-5 bg-primary text-white text-xs flex items-center justify-center rounded-full">
										✓
									</div>
								)}
							</button>
						);
					})}
				</div>
			</adc-section-panel>
		</adc-page-shell>
	);
}
