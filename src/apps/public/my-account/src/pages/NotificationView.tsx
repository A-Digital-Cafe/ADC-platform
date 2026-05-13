import { useTranslation } from "@ui-library/utils/i18n-react";

export default function NotificationView() {
	const { t } = useTranslation({ namespace: "my-account", autoLoad: true });

	return (
		<div className="w-full flex flex-col pl-25 lg:pl-70">
			{/* Title */}
			<div className="mb-4">
				<h2 className="font-bold text-text">{t("notifications.title")}</h2>
				<p className="text-muted">{t("notifications.subtitle")}</p>
			</div>

			<div className="bg-surface p-8 pb-6 rounded-xxl">
				{/* Header */}
				<div className="mb-6">
					<h3 className="mt-0! text-lg font-semibold text-text">{t("notifications.panelTitle")}</h3>
					<p className="text-sm text-muted">{t("notifications.panelDescription")}</p>
				</div>

				{/* Empty state */}
				<div className="flex flex-col items-center justify-center text-center py-16">
					{/* Icono */}
					<div className="w-16 h-16 rounded-full flex items-center justify-center mb-6">
						<svg className="w-8 h-8 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth="2"
								d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659M6 6.343A6.002 6.002 0 006 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0a3 3 0 11-6 0m6 0H9"
							/>
							<line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
						</svg>
					</div>

					{/* Texto */}
					<h4 className="text-lg font-semibold text-text mb-2">{t("notifications.emptyTitle")}</h4>

					<p className="text-muted max-w-md">{t("notifications.emptyDescription")}</p>
				</div>
			</div>
		</div>
	);
}
