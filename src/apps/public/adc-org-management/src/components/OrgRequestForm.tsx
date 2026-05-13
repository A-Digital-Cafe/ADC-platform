import React, { useState } from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";
import { orgApi } from "../utils/org-api.js";
import { toast } from "../utils/toast.js";
import type { SocialNetwork } from "../utils/org-api.js";
import { OrgFormBase } from "./OrgFormBase.js";
import { SocialNetworksManager } from "./SocialNetworksManager.js";
import { OrgRequestSuccess } from "./OrgRequestSuccess.js";

interface FormData {
	orgName: string;
	email: string;
	description: string;
	url: string;
}

interface OrgRequestFormProps {
	onSuccess?: () => void;
}

/**
 * Formulario para solicitar nueva organización
 * Puede ser embebido en HomeView o usado en OrgRequestView como página standalone
 */
export const OrgRequestForm: React.FC<OrgRequestFormProps> = ({ onSuccess }) => {
	const { t } = useTranslation({ namespace: "adc-org-management", autoLoad: true });
	const [formData, setFormData] = useState<FormData>({
		orgName: "",
		email: "",
		description: "",
		url: "",
	});

	const [socialNetworks, setSocialNetworks] = useState<Omit<SocialNetwork, "icon">[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState(false);

	// Form handlers
	const handleFormChange = (field: keyof FormData, value: string) => {
		setFormData((prev) => ({ ...prev, [field]: value }));
	};

	const handleClearError = () => {
		setError(null);
	};

	// Social network handlers
	const handleAddSocialNetwork = () => {
		setSocialNetworks((prev) => [
			...prev,
			{
				platform: "",
				url: "",
			},
		]);
	};

	const handleRemoveSocialNetwork = (idx: number) => {
		setSocialNetworks((prev) => prev.filter((_, index) => index !== idx));
	};

	const handleSocialNetworkChange = (idx: number, field: "platform" | "url", value: string) => {
		setSocialNetworks((prev) => prev.map((s, i) => (i === idx ? { ...s, [field]: value } : s)));
	};

	// Form submission
	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError(null);
		setLoading(true);

		// Validar nombre
		if (!formData.orgName.trim()) {
			const msg = t("request.errors.nameRequired");
			setError(msg);
			toast.error(msg);
			setLoading(false);
			return;
		}

		if (formData.orgName.trim().length < 3) {
			const msg = t("request.errors.nameMinLength");
			setError(msg);
			toast.error(msg);
			setLoading(false);
			return;
		}

		// Validar email
		if (!formData.email.trim()) {
			const msg = t("request.errors.emailRequired");
			setError(msg);
			toast.error(msg);
			setLoading(false);
			return;
		}

		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		if (!emailRegex.test(formData.email)) {
			const msg = t("request.errors.emailInvalid");
			setError(msg);
			toast.error(msg);
			setLoading(false);
			return;
		}

		// Validar URL (opcional)
		if (formData.url.trim()) {
			try {
				new URL(formData.url);
			} catch {
				const msg = t("request.errors.urlInvalid");
				setError(msg);
				toast.error(msg);
				setLoading(false);
				return;
			}
		}

		try {
			const result = await orgApi.requestOrganization({
				name: formData.orgName,
				email: formData.email,
				description: formData.description,
				url: formData.url,
				socialNetworks: socialNetworks.length > 0 ? socialNetworks : undefined,
			});

			if ((result as any)?.data?.success || (result as any)?.success) {
				// Limpiar formulario
				setFormData({ orgName: "", email: "", description: "", url: "" });
				setSocialNetworks([]);
				toast.success(t("home.requestSuccess"));
				setSuccess(true);
				onSuccess?.();
				return;
			}

			toast.error(t("request.errors.submitError"));
			setLoading(false);
		} catch (err) {
			console.error("❌ Error al enviar:", err);
			const errorMsg = err instanceof Error ? err.message : t("request.errors.submitError");
			setError(errorMsg);
			toast.error(errorMsg);
			setLoading(false);
		}
	};

	if (success) {
		return (
			<OrgRequestSuccess
				onGoHome={() => {
					setSuccess(false);
					setFormData({ orgName: "", email: "", description: "", url: "" });
					setSocialNetworks([]);
				}}
			/>
		);
	}

	return (
		<form onSubmit={handleSubmit} className="space-y-6">
			<OrgFormBase formData={formData} error={error} onFormChange={handleFormChange} onClearError={handleClearError} />
            <div className="border-t border-border" />

			<SocialNetworksManager
				socialNetworks={socialNetworks}
				onAddSocialNetwork={handleAddSocialNetwork}
				onRemoveSocialNetwork={handleRemoveSocialNetwork}
				onSocialNetworkChange={handleSocialNetworkChange}
			/>

			{/* Info Box */}
			<div className="bg-info border border-info rounded-lg p-4 flex gap-3">
				<svg className="w-5 h-5 text-tinfo shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
					<path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
				</svg>
				<p className="text-sm text-tinfo">
					{t("home.submitInfo")}
				</p>
			</div>

			{/* Submit Buttons */}
			<div className="flex gap-3 pt-4">
				<adc-button type="submit" disabled={loading} class="w-full">
					{loading ? t("common.sending") : t("request.form.submit")}
				</adc-button>
			</div>
		</form>
	);
};
