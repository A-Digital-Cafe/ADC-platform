import { useState } from "react";
import { accountApi } from "../utils/account-api";
import { toast } from "@ui-library/utils/toast";
import { useTranslation } from "@ui-library/utils/i18n-react";

const AUTH_URL = "http://localhost:3012";

export default function AdminView() {
	const { t } = useTranslation({ namespace: "my-account", autoLoad: true });
	const [modalOpen, setModalOpen] = useState(false);
	const [deleting, setDeleting] = useState(false);

	const handleLogout = async () => {
		const res = await accountApi.logout();
		if (!res.success) {
			toast.warning(t("admin.logoutWarning"));
		}

		globalThis.location.href = `${AUTH_URL}/login`;
	};

	const handleDeleteAccount = async () => {
		setDeleting(true);

		try {
			await accountApi.deleteCurrentUser();

			toast.success(t("admin.deleteSuccess"));

			setTimeout(() => handleLogout(), 1500);
		} catch (err) {
			console.error(err);

			toast.error(t("admin.deleteError"));
		} finally {
			setDeleting(false);
			setModalOpen(false);
		}
	};

	return (
		<>
			{modalOpen && (
				<adc-modal
					open
					modalTitle={t("admin.modalTitle")}
					size="lg"
					dismissOnBackdrop={!deleting}
					dismissOnEscape={!deleting}
					onadcClose={() => setModalOpen(false)}
				>
					<div className="flex flex-col items-center py-6 px-2">
						<div className="flex items-center justify-center w-16 h-16 rounded-full bg-danger mb-4">
							<svg className="w-10 h-10 text-tdanger" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									d="M12 8v4m0 4h.01M4.5 19h15c1.1 0 1.8-1.2 1.2-2.1L13.2 5.3c-.6-1-2-1-2.6 0L3.3 16.9c-.6.9.1 2.1 1.2 2.1z"
								/>
							</svg>
						</div>
						<h3 className="text-xl font-semibold text-center text-tdanger mb-2">{t("admin.modalHeading")}</h3>
						<p className="mb-4 text-base text-center text-text max-w-xl">
							{t("admin.deleteConfirmPrefix")} <span className="font-bold text-tdanger">{t("admin.deleteConfirmEmphasis")}</span>{" "}
							{t("admin.deleteConfirmSuffix")}
						</p>
						<div className="flex flex-row justify-center gap-4 w-full mt-4">
							<adc-button type="button" class="min-w-35" disabled={deleting} onClick={() => setModalOpen(false)}>
								{t("admin.cancel")}
							</adc-button>
							<adc-button type="button" class="min-w-35" disabled={deleting} onClick={handleDeleteAccount}>
								{deleting ? t("admin.deleting") : t("admin.deleteAction")}
							</adc-button>
						</div>
					</div>
				</adc-modal>
			)}
			<adc-page-shell heading={t("admin.title")} description={t("admin.subtitle")} headerSpacing="sm">
				<adc-section-panel>
					{/* Header */}
					<div className="flex items-center gap-3">
						<div className="w-10 h-10 rounded-full bg-danger/90 flex items-center justify-center shadow-sm">
							<svg
								className="w-6 h-6 text-twarn"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.8"
								strokeLinecap="round"
								strokeLinejoin="round"
							>
								<path d="M12 8v4" />
								<path d="M12 16h.01" />
								<path d="M4.5 19h15c1.1 0 1.8-1.2 1.2-2.1L13.2 5.3c-.6-1-2-1-2.6 0L3.3 16.9c-.6.9.1 2.1 1.2 2.1z" />
							</svg>
						</div>

						<div>
							<h3 className="text-base font-semibold text-text">{t("admin.deleteAccountTitle")}</h3>
							<p className="text-sm text-muted">{t("admin.deleteAccountDescription")}</p>
						</div>
					</div>

					<adc-divider />

					{/* Content */}
					<div className="flex flex-col gap-5">
						{/* Warning */}
						<div className="flex items-start gap-3 text-twarn bg-warn/30 border border-warn/30 p-3 rounded-lg">
							<div className="w-6 h-6 flex items-center justify-center rounded-full bg-warn shrink-0">
								<span className="text-xs font-bold">!</span>
							</div>

							<p className="text-sm leading-relaxed">{t("admin.warning")}</p>
						</div>

						{/* Action */}
						<div className="flex items-center justify-end flex-wrap gap-3">
							<adc-button type="button" onClick={() => setModalOpen(true)}>
								{t("admin.openDelete")}
							</adc-button>
						</div>
					</div>
				</adc-section-panel>
			</adc-page-shell>
		</>
	);
}
