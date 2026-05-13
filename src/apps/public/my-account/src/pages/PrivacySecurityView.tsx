import React, { useState } from "react";
import { accountApi } from "../utils/account-api";
import { toast } from "../utils/toast";
import { useTranslation } from "@ui-library/utils/i18n-react";
export default function PrivacySecurityView() {
	const { t } = useTranslation({ namespace: "my-account", autoLoad: true });
	const [currentPassword, setCurrentPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");

	const [showCurrent, setShowCurrent] = useState(false);
	const [showNew, setShowNew] = useState(false);
	const [showConfirm, setShowConfirm] = useState(false);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();

		// Validaciones
		if (!currentPassword || !newPassword || !confirmPassword) {
			toast.error(t("privacy.fieldsRequired"));
			return;
		}

		if (newPassword.length < 8) {
			toast.warning(t("privacy.minLength"));
			return;
		}

		if (newPassword !== confirmPassword) {
			toast.error(t("privacy.mismatch"));
			return;
		}

		try {
			await accountApi.changePassword(currentPassword, newPassword);

			toast.success(t("privacy.updated"));

			setCurrentPassword("");
			setNewPassword("");
			setConfirmPassword("");
		} catch (error: any) {
			console.error(error);

			toast.error(t("privacy.changeError"));
		}
	};
	return (
		<div className="w-full flex flex-col pl-25 lg:pl-70">
			{/* Title */}
			<div className="mb-4">
				<h2 className="text-2xl font-bold text-text">{t("privacy.title")}</h2>
				<p className="text-muted">{t("privacy.subtitle")}</p>
			</div>

			{/* Panel */}
			<div className="bg-surface p-8 pb-6 rounded-xxl">
				{/* Header */}
				<div className="mb-6">
					<h3 className="mt-0! text-lg font-semibold text-text">{t("privacy.panelTitle")}</h3>
					<p className="text-sm text-muted">{t("privacy.panelDescription")}</p>
				</div>

				{/* Contenido centrado */}
				<div className="max-w-2xl mx-auto">
					<form onSubmit={handleSubmit} className="space-y-5">
						{/* Contraseña actual */}
						<div>
							<label htmlFor="current-password" className="block text-sm mb-1 text-text">
								{t("privacy.currentPassword")}
							</label>

							<div className="relative">
								<adc-input
									inputId="current-password"
									type={showCurrent ? "text" : "password"}
									value={currentPassword}
									class="w-full pr-12"
									onInput={(e) => setCurrentPassword((e.target as HTMLInputElement).value)}
								/>

								<button
									type="button"
									onClick={() => setShowCurrent(!showCurrent)}
									className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted"
								>
									{showCurrent ? t("privacy.hidePassword") : t("privacy.showPassword")}
								</button>
							</div>
						</div>

						{/* Nueva contraseña */}
						<div>
							<label htmlFor="new-password" className="block text-sm mb-1 text-text">
								{t("privacy.newPassword")}
							</label>

							<div className="relative">
								<adc-input
									inputId="new-password"
									type={showNew ? "text" : "password"}
									value={newPassword}
									class="w-full pr-12"
									onInput={(e) => setNewPassword((e.target as HTMLInputElement).value)}
								/>

								<button
									type="button"
									onClick={() => setShowNew(!showNew)}
									className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted"
								>
									{showNew ? t("privacy.hidePassword") : t("privacy.showPassword")}
								</button>
							</div>
						</div>

						{/* Confirmar contraseña */}
						<div>
							<label htmlFor="confirm-password" className="block text-sm mb-1 text-text">
								{t("privacy.confirmPassword")}
							</label>

							<div className="relative">
								<adc-input
									inputId="confirm-password"
									type={showConfirm ? "text" : "password"}
									value={confirmPassword}
									class="w-full pr-12"
									onInput={(e) => setConfirmPassword((e.target as HTMLInputElement).value)}
								/>

								<button
									type="button"
									onClick={() => setShowConfirm(!showConfirm)}
									className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted"
								>
									{showConfirm ? t("privacy.hidePassword") : t("privacy.showPassword")}
								</button>
							</div>
						</div>

						{/* Submit */}
						<div className="flex flex-col sm:flex-row sm:justify-end gap-3 pt-4">
							<adc-button type="submit" variant="primary">
								{t("privacy.submit")}
							</adc-button>
						</div>
					</form>
				</div>
			</div>
		</div>
	);
}
