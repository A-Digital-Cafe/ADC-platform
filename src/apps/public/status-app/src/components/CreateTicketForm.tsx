import React, { useState, type ReactElement } from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";
import { ticketApi, type CreateSupportTicketInput, type SupportTicketType } from "../utils/ticket-api";
import {
	TICKET_TYPE_LABELS,
	SUPPORT_TICKET_CONSTRAINTS,
	SUPPORT_TICKET_VALIDATORS,
	validateStringField,
	type SelectOption,
} from "@common/types/project-manager/SupportTicket.ts";
import { TicketSuccess } from "./TicketSuccess.js";
import { toast } from "../utils/toast";

interface FormData {
	type: SupportTicketType;
	title: string;
	email: string;
	description: string;
}

interface InputEventLike {
	readonly target: EventTarget | null;
}

type Translate = (key: string) => string;

interface ValidationResult {
	readonly error?: string;
	readonly data?: CreateSupportTicketInput;
}

interface CreateTicketFormProps {
	readonly onSuccess?: () => void;
	readonly onCancel?: () => void;
}

// Función para obtener datos de formulario por defecto
function getDefaultFormData(): FormData {
	return {
		type: "complaint",
		title: "",
		email: "",
		description: "",
	};
}

// Función para normalizar datos del formulario
function normalizeFormData(formData: FormData): FormData {
	return {
		type: formData.type,
		title: formData.title.trim(),
		email: formData.email.toLowerCase().trim(),
		description: formData.description.trim(),
	};
}

// Función tipada para obtener mensaje de error (traduce códigos del backend)
function getErrorMessage(err: unknown, t: Translate): string {
	if (err instanceof Error) {
		const message = err.message;

		// Detecta formato de código de error: "field:reason" (ej: "title:minLength")
		if (message.includes(":") && !message.includes(" ") && !message.includes("http")) {
			const [field, code] = message.split(":");
			// Convierte "minLength" a "MinLength" para la clave i18n
			const codePascal = code.charAt(0).toUpperCase() + code.slice(1);
			const translationKey = `tickets.errors.${field}${codePascal}`;
			const translated = t(translationKey);

			// Si la traducción existe (no devuelve la misma clave), usa la traducción
			if (translated !== translationKey) {
				return translated;
			}
		}

		return message;
	}
	if (typeof err === "string") return err;
	return t("tickets.errors.submitError") || "Error creating ticket";
}

function validateTicketData(formData: Readonly<FormData>, t: Translate): ValidationResult {
	const normalized = normalizeFormData(formData);
	const { title, email, description } = normalized;

	// Validar título
	const titleValidation = validateStringField(title, SUPPORT_TICKET_VALIDATORS.title);
	if (!titleValidation.valid) {
		const errorMap: Record<string, string> = {
			required: t("tickets.errors.titleRequired") || "Title is required",
			minLength: t("tickets.errors.titleMinLength") || `Title must be at least ${SUPPORT_TICKET_CONSTRAINTS.title.min} characters`,
			maxLength: t("tickets.errors.titleMaxLength") || `Title must not exceed ${SUPPORT_TICKET_CONSTRAINTS.title.max} characters`,
			pattern: "",
		};
		return { error: errorMap[titleValidation.reason] };
	}

	// Validar email
	const emailValidation = validateStringField(email, SUPPORT_TICKET_VALIDATORS.email);
	if (!emailValidation.valid) {
		const errorMap: Record<string, string> = {
			required: t("tickets.errors.emailRequired") || "Email is required",
			maxLength: t("tickets.errors.emailMaxLength") || "Email is too long",
			pattern: t("tickets.errors.emailPattern") || "Invalid email address",
			minLength: "",
		};
		return { error: errorMap[emailValidation.reason] };
	}

	// Validar descripción
	const descriptionValidation = validateStringField(description, SUPPORT_TICKET_VALIDATORS.description);
	if (!descriptionValidation.valid) {
		const errorMap: Record<string, string> = {
			required: t("tickets.errors.descriptionRequired") || "Description is required",
			minLength:
				t("tickets.errors.descriptionMinLength") ||
				`Description must be at least ${SUPPORT_TICKET_CONSTRAINTS.description.min} characters`,
			maxLength:
				t("tickets.errors.descriptionMaxLength") ||
				`Description must not exceed ${SUPPORT_TICKET_CONSTRAINTS.description.max} characters`,
			pattern: "",
		};
		return { error: errorMap[descriptionValidation.reason] };
	}

	return {
		data: {
			type: normalized.type,
			title: normalized.title,
			email: normalized.email,
			description: normalized.description,
		},
	};
}

function getInputValue(event: InputEventLike): string {
	return (event.target as HTMLInputElement | HTMLTextAreaElement).value;
}

export default function CreateTicketForm({ onSuccess, onCancel }: CreateTicketFormProps): ReactElement {
	const { t } = useTranslation({ namespace: "status-app", autoLoad: true });

	const [formData, setFormData] = useState<FormData>(getDefaultFormData());
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState(false);

	// Helper para actualizar campos y limpiar errores
	const updateField = <K extends keyof FormData>(field: K, value: FormData[K]): void => {
		setFormData((prev) => ({ ...prev, [field]: value }));
		setError(null);
	};

	const handleReset = (): void => {
		setFormData(getDefaultFormData());
		setError(null);
	};

	const handleSubmit = async (e: React.SubmitEvent<HTMLFormElement>): Promise<void> => {
		e.preventDefault();
		setError(null);
		setLoading(true);

		const validation = validateTicketData(formData, t);

		if (validation.error || !validation.data) {
			const msg = (validation.error ?? t("tickets.errors.submitError")) || "Error creating ticket";

			setError(msg);
			toast.error(msg);
			setLoading(false);
			return;
		}

		try {
			const response = await ticketApi.create(validation.data);

			if (response?.data?.ticketKey) {
				handleReset();

				toast.success(t("tickets.successTitle") || `Ticket created: ${response.data.ticketKey}`);

				setSuccess(true);
				onSuccess?.();
				return;
			}

			toast.error(t("tickets.errors.submitError") || "Error creating ticket");

			setLoading(false);
		} catch (err) {
			const errorMsg = getErrorMessage(err, t);

			setError(errorMsg);
			toast.error(errorMsg);
			setLoading(false);
		}
	};

	if (success) {
		return (
			<TicketSuccess
				onGoBack={() => {
					setSuccess(false);
					handleReset();
				}}
			/>
		);
	}

	const ticketTypeOptions: SelectOption[] = [
		{ value: "complaint", label: t("tickets.form.typeComplaint") || TICKET_TYPE_LABELS.complaint },
		{ value: "suggestion", label: t("tickets.form.typeSuggestion") || TICKET_TYPE_LABELS.suggestion },
		{ value: "security", label: t("tickets.form.typeSecurity") || TICKET_TYPE_LABELS.security },
	];

	return (
		<div className="rounded-lg p-6 bg-surface">
			<h3 className="font-semibold text-lg text-text mb-4">{t("tickets.form.title") || "Create New Ticket"}</h3>
			<form onSubmit={handleSubmit} className="space-y-4">
				{error && (
					<div id="error-message" className="bg-danger border border-danger rounded-lg p-4 text-sm text-tdanger">
						{error}
					</div>
				)}

				{/* Type Selection */}
				<div className="space-y-2">
					<label className="block text-sm font-medium text-text">
						{t("tickets.form.type") || "Ticket Type"}
						<span className="text-danger ml-1">*</span>
					</label>
					<adc-select
						value={formData.type}
						options={JSON.stringify(ticketTypeOptions)}
						placeholder={t("tickets.form.type") || "Select a type"}
						onadcChange={(event) => updateField("type", event.detail as SupportTicketType)}
					/>
				</div>

				{/* Title */}
				<div className="space-y-2">
					<label htmlFor="title" className="block text-sm font-medium text-text">
						{t("tickets.form.titleField") || "Title"}
						<span className="text-danger ml-1">*</span>
					</label>
					<adc-input
						inputId="title"
						name="title"
						type="text"
						placeholder={t("tickets.form.titlePlaceholder") || "Describe your issue..."}
						value={formData.title}
						onInput={(event) => updateField("title", getInputValue(event))}
					/>
					<p className="text-xs text-muted">
						{SUPPORT_TICKET_CONSTRAINTS.title.min}-{SUPPORT_TICKET_CONSTRAINTS.title.max} characters
					</p>
				</div>

				{/* Email */}
				<div className="space-y-2">
					<label htmlFor="email" className="block text-sm font-medium text-text">
						{t("tickets.form.email") || "Contact Email"}
						<span className="text-danger ml-1">*</span>
					</label>
					<adc-input
						inputId="email"
						name="email"
						type="email"
						placeholder="your@email.com"
						value={formData.email}
						onInput={(event) => updateField("email", getInputValue(event))}
					/>
				</div>

				{/* Description */}
				<div className="space-y-2">
					<label htmlFor="description" className="block text-sm font-medium text-text">
						{t("tickets.form.description") || "Description"}
						<span className="text-danger ml-1">*</span>
					</label>
					<adc-textarea
						textareaId="description"
						name="description"
						placeholder={t("tickets.form.descriptionPlaceholder") || "Provide detailed information..."}
						value={formData.description}
						rows={5}
						onInput={(event) => updateField("description", getInputValue(event))}
					/>
					<p className="text-xs text-muted">
						{SUPPORT_TICKET_CONSTRAINTS.description.min}-{SUPPORT_TICKET_CONSTRAINTS.description.max} characters
					</p>
				</div>

				<div className="bg-info border border-info rounded-lg p-4 flex gap-3 items-center" role="alert">
					<svg className="w-5 h-5 text-tinfo shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
						<path
							fillRule="evenodd"
							d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
							clipRule="evenodd"
						/>
					</svg>
					<p className="text-sm text-tinfo">{t("tickets.submitInfo") || "Our team will review your ticket shortly."}</p>
				</div>

				{/* Submit Button */}
				<div className="flex gap-2 justify-end pt-4">
					<button
						type="button"
						onClick={() => {
							handleReset();
							onCancel?.();
						}}
						disabled={loading}
						className="px-4 py-2 border border-border rounded-lg font-medium text-text hover:bg-surface-hover disabled:opacity-50 transition-colors"
					>
						{t("tickets.form.cancel") || "Cancel"}
					</button>
					<button
						type="submit"
						disabled={loading}
						className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
					>
						{loading ? t("common.sending") || "Sending..." : t("tickets.form.submit") || "Submit"}
					</button>
				</div>
			</form>
		</div>
	);
}
