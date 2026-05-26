import { useState } from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";
import { orgRequestApi, type CreateOrganizationRequestInput, type OrganizationRequestSocialNetwork } from "../utils/pm-api.js";
import { toast } from "../utils/toast.js";
import { OrgFormBase } from "./OrgFormBase.js";
import { SocialNetworksManager, type EditableOrganizationRequestSocialNetwork } from "./SocialNetworksManager.js";
import { OrgRequestSuccess } from "./OrgRequestSuccess.js";
import { createClientId } from "@common/utils/client-crypto.ts";

interface FormData {
	orgName: string;
	email: string;
	description: string;
	url: string;
}

interface OrgRequestFormProps {
	readonly onSuccess?: () => void;
}

interface SubmitEventLike {
	preventDefault: () => void;
}

type Translate = (key: string) => string;

interface ValidationResult {
	readonly error?: string;
	readonly data?: CreateOrganizationRequestInput;
}

function isValidHttpUrl(value: string): boolean {
	try {
		const parsedUrl = new URL(value);
		return ["http:", "https:"].includes(parsedUrl.protocol);
	} catch {
		return false;
	}
}

function normalizeSocialNetworks(socialNetworks: readonly OrganizationRequestSocialNetwork[]): OrganizationRequestSocialNetwork[] {
	return socialNetworks
		.map(({ platform, url }) => ({ platform: platform.trim(), url: url.trim() }))
		.filter(({ platform, url }) => platform || url);
}

function validateRequestData(formData: FormData, socialNetworks: readonly OrganizationRequestSocialNetwork[], t: Translate): ValidationResult {
	const name = formData.orgName.trim();
	const email = formData.email.trim();
	const description = formData.description.trim();
	const url = formData.url.trim();

	if (!name) return { error: t("request.errors.nameRequired") };
	if (name.length < 3) return { error: t("request.errors.nameMinLength") };
	if (!email) return { error: t("request.errors.emailRequired") };
	if (!/^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,63}$/u.test(email)) return { error: t("request.errors.emailInvalid") };
	if (description.length > 2000) return { error: t("request.errors.descriptionTooLong") };
	if (url && !isValidHttpUrl(url)) return { error: t("request.errors.urlInvalid") };

	const normalizedSocialNetworks = normalizeSocialNetworks(socialNetworks);
	if (normalizedSocialNetworks.some((item) => !item.platform || !item.url)) return { error: t("request.errors.socialNetworkInvalid") };
	if (normalizedSocialNetworks.some((item) => !isValidHttpUrl(item.url))) return { error: t("request.errors.socialNetworkUrlInvalid") };

	return {
		data: {
			name,
			email,
			description: description || undefined,
			url: url || undefined,
			socialNetworks: normalizedSocialNetworks.length > 0 ? normalizedSocialNetworks : undefined,
		},
	};
}

export function OrgRequestForm({ onSuccess }: OrgRequestFormProps) {
	const { t } = useTranslation({ namespace: "adc-org-management", autoLoad: true });
	const [formData, setFormData] = useState<FormData>({
		orgName: "",
		email: "",
		description: "",
		url: "",
	});

	const [socialNetworks, setSocialNetworks] = useState<EditableOrganizationRequestSocialNetwork[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState(false);

	const handleFormChange = (field: keyof FormData, value: string) => {
		setFormData((prev) => ({ ...prev, [field]: value }));
	};

	const handleClearError = () => {
		setError(null);
	};

	const handleAddSocialNetwork = () => {
		setSocialNetworks((prev) => [
			...prev,
			{
				clientId: createClientId(),
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

	const handleSubmit = async (e: SubmitEventLike) => {
		e.preventDefault();
		setError(null);
		setLoading(true);

		const validation = validateRequestData(formData, socialNetworks, t);
		if (validation.error || !validation.data) {
			const msg = validation.error ?? t("request.errors.submitError");
			setError(msg);
			toast.error(msg);
			setLoading(false);
			return;
		}

		try {
			const result = await orgRequestApi.create(validation.data);

			if (result.success && result.data) {
				setFormData({ orgName: "", email: "", description: "", url: "" });
				setSocialNetworks([]);
				toast.success(t("home.requestSuccess"));
				setSuccess(true);
				onSuccess?.();
				return;
			}

			toast.error(t("request.errors.submitError"));
			setLoading(false);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : t("request.errors.submitError");
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

			<div className="bg-info border border-info rounded-lg p-4 flex gap-3 items-center" role="alert">
				<svg className="w-5 h-5 text-tinfo shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
					<path
						fillRule="evenodd"
						d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
						clipRule="evenodd"
					/>
				</svg>
				<p className="text-sm text-tinfo">{t("home.submitInfo")}</p>
			</div>

			<div className="flex gap-3 pt-4">
				<adc-button type="submit" disabled={loading} class="w-full">
					{loading ? t("common.sending") : t("request.form.submit")}
				</adc-button>
			</div>
		</form>
	);
}
