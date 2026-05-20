import React, { useState, useRef, useEffect, type ReactElement, type RefObject } from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";
import { ticketApi, type CreateSupportTicketInput, type SupportTicketType } from "../utils/ticket-api";
import { TICKET_TYPE_LABELS, SUPPORT_TICKET_CONSTRAINTS, EMAIL_REGEX } from "@common/types/project-manager/SupportTicket.ts";
import { TicketSuccess } from "./TicketSuccess.js";
import { toast } from "../utils/toast";
// Tipos específicos para Web Components
interface AdcSelectElement extends HTMLElement {
	value: SupportTicketType;
}

interface AdcInputElement extends HTMLElement {
	value: string;
	querySelector(selector: "input"): HTMLInputElement | null;
}

interface AdcTextareaElement extends HTMLElement {
	value: string;
	querySelector(selector: "textarea"): HTMLTextAreaElement | null;
}

interface FormData {
	type: SupportTicketType;
	title: string;
	email: string;
	description: string;
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

interface SelectOption {
	value: SupportTicketType;
	label: string;
}

// Usar constantes de backend para mantener sincronización
const TICKET_CONSTRAINTS = SUPPORT_TICKET_CONSTRAINTS;

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

// Función tipada para obtener mensaje de error
function getErrorMessage(err: unknown, t: Translate): string {
	if (err instanceof Error) return err.message;
	if (typeof err === "string") return err;
	return t("tickets.errors.submitError") || "Error creating ticket";
}

function validateTicketData(formData: Readonly<FormData>, t: Translate): ValidationResult {
	const normalized = normalizeFormData(formData);
	const { title, email, description } = normalized;

	if (!title) return { error: t("tickets.errors.titleRequired") || "Title is required" };
	if (title.length < TICKET_CONSTRAINTS.title.min)
		return { error: t("tickets.errors.titleMinLength") || `Title must be at least ${TICKET_CONSTRAINTS.title.min} characters` };
	if (title.length > TICKET_CONSTRAINTS.title.max)
		return { error: t("tickets.errors.titleMaxLength") || `Title must not exceed ${TICKET_CONSTRAINTS.title.max} characters` };

	if (!email) return { error: t("tickets.errors.emailRequired") || "Email is required" };
	if (email.length > TICKET_CONSTRAINTS.email.max) return { error: t("tickets.errors.emailTooLong") || "Email is too long" };
	if (!EMAIL_REGEX.test(email)) return { error: t("tickets.errors.emailInvalid") || "Invalid email address" };

	if (!description) return { error: t("tickets.errors.descriptionRequired") || "Description is required" };
	if (description.length < TICKET_CONSTRAINTS.description.min)
		return {
			error: t("tickets.errors.descriptionMinLength") || `Description must be at least ${TICKET_CONSTRAINTS.description.min} characters`,
		};
	if (description.length > TICKET_CONSTRAINTS.description.max)
		return {
			error: t("tickets.errors.descriptionMaxLength") || `Description must not exceed ${TICKET_CONSTRAINTS.description.max} characters`,
		};

	return {
		data: {
			type: normalized.type,
			title: normalized.title,
			email: normalized.email,
			description: normalized.description,
		},
	};
}

export default function CreateTicketForm({ onSuccess, onCancel }: CreateTicketFormProps): ReactElement {
	const { t } = useTranslation({ namespace: "status-app", autoLoad: true });

	const [formData, setFormData] = useState<FormData>(getDefaultFormData());
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState(false);

	// Refs para los Web Components
	const typeSelectRef = useRef<AdcSelectElement>(null);
	const titleInputRef = useRef<AdcInputElement>(null);
	const emailInputRef = useRef<AdcInputElement>(null);
	const descriptionRef = useRef<AdcTextareaElement>(null);

	// Setup listeners para Web Components
	useEffect(() => {
		const setupSelectListener = (): (() => void) | undefined => {
			if (!typeSelectRef.current) return;
			const handler = (e: CustomEvent<SupportTicketType>) => {
				if (e.detail !== undefined && e.detail !== null) {
					setFormData((prev) => ({ ...prev, type: e.detail }));
					setError(null);
				}
			};
			typeSelectRef.current.addEventListener("adcChange", handler as EventListener);
			return () => typeSelectRef.current?.removeEventListener("adcChange", handler as EventListener);
		};

		const setupInputListener = (ref: RefObject<AdcInputElement | null>, field: "title" | "email"): (() => void) | undefined => {
			if (!ref.current) return;
			const input = ref.current.querySelector("input") || (ref.current as unknown as HTMLInputElement);
			if (!input) return;
			const handler = (e: Event) => {
				const value = (e.target as HTMLInputElement).value;
				setFormData((prev) => ({ ...prev, [field]: value }));
				setError(null);
			};
			input.addEventListener("input", handler);
			return () => input?.removeEventListener("input", handler);
		};

		const setupTextareaListener = (): (() => void) | undefined => {
			if (!descriptionRef.current) return;
			const textarea = descriptionRef.current.querySelector("textarea") || (descriptionRef.current as unknown as HTMLTextAreaElement);
			if (!textarea) return;
			const handler = (e: Event) => {
				const value = (e.target as HTMLTextAreaElement).value;
				setFormData((prev) => ({ ...prev, description: value }));
				setError(null);
			};
			textarea.addEventListener("input", handler);
			return () => textarea?.removeEventListener("input", handler);
		};

		const unsubscribeSelect = setupSelectListener();
		const unsubscribeTitle = setupInputListener(titleInputRef, "title");
		const unsubscribeEmail = setupInputListener(emailInputRef, "email");
		const unsubscribeTextarea = setupTextareaListener();

		return () => {
			unsubscribeSelect?.();
			unsubscribeTitle?.();
			unsubscribeEmail?.();
			unsubscribeTextarea?.();
		};
	}, []);

	const handleReset = (): void => {
		setFormData(getDefaultFormData());
		setError(null);
	};

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
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

			if (response && response.data?.ticketKey) {
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
					<div id="error-message" className="bg-danger/10 border border-danger/20 rounded-lg p-4 text-sm text-danger">
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
						ref={typeSelectRef}
						value={formData.type}
						options={JSON.stringify(ticketTypeOptions)}
						placeholder={t("tickets.form.type") || "Select a type"}
					/>
				</div>

				{/* Title */}
				<div className="space-y-2">
					<label htmlFor="title" className="block text-sm font-medium text-text">
						{t("tickets.form.titleField") || "Title"}
						<span className="text-danger ml-1">*</span>
					</label>
					<adc-input
						ref={titleInputRef}
						inputId="title"
						name="title"
						type="text"
						placeholder={t("tickets.form.titlePlaceholder") || "Describe your issue..."}
						value={formData.title}
					/>
					<p className="text-xs text-muted">
					{TICKET_CONSTRAINTS.title.min}-{TICKET_CONSTRAINTS.title.max} characters
					</p>
				</div>

				{/* Email */}
				<div className="space-y-2">
					<label htmlFor="email" className="block text-sm font-medium text-text">
						{t("tickets.form.email") || "Contact Email"}
						<span className="text-danger ml-1">*</span>
					</label>
					<adc-input
						ref={emailInputRef}
						inputId="email"
						name="email"
						type="email"
						placeholder="your@email.com"
						value={formData.email}
					/>
				</div>

				{/* Description */}
				<div className="space-y-2">
					<label htmlFor="description" className="block text-sm font-medium text-text">
						{t("tickets.form.description") || "Description"}
						<span className="text-danger ml-1">*</span>
					</label>
					<adc-textarea
						ref={descriptionRef}
						textareaId="description"
						name="description"
						placeholder={t("tickets.form.descriptionPlaceholder") || "Provide detailed information..."}
						value={formData.description}
						rows={5}
					/>
					<p className="text-xs text-muted">
					{TICKET_CONSTRAINTS.description.min}-{TICKET_CONSTRAINTS.description.max} characters
					</p>
				</div>

				<div className="bg-info border border-info rounded-lg p-4 flex gap-3" role="note">
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
