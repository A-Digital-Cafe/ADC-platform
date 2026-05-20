import { useRef, useEffect, type RefObject } from "react";

interface FormData {
	orgName: string;
	email: string;
	description: string;
	url: string;
}

interface OrgFormBaseProps {
	readonly formData: FormData;
	readonly error: string | null;
	readonly onFormChange: (field: keyof FormData, value: string) => void;
	readonly onClearError: () => void;
}

export function OrgFormBase({ formData, error, onFormChange, onClearError }: OrgFormBaseProps) {
	const nameInputRef = useRef<any>(null);
	const emailInputRef = useRef<any>(null);
	const descriptionRef = useRef<any>(null);
	const urlInputRef = useRef<any>(null);

	useEffect(() => {
		const setupInputListener = (ref: RefObject<any>, field: keyof FormData) => {
			if (ref.current) {
				// Acceder al <input> nativo dentro de adc-input
				const input = ref.current.querySelector("input") || ref.current;
				const handler = (e: Event) => {
					const value = (e.target as HTMLInputElement).value;
					onFormChange(field, value);
					onClearError();
				};
				input.addEventListener("input", handler);
				return () => input?.removeEventListener("input", handler);
			}
		};

		const setupTextareaListener = (ref: RefObject<any>, field: keyof FormData) => {
			if (ref.current) {
				const textarea = ref.current.querySelector("textarea") || ref.current;
				const handler = (e: Event) => {
					const value = (e.target as HTMLTextAreaElement).value;
					onFormChange(field, value);
					onClearError();
				};
				textarea.addEventListener("input", handler);
				return () => textarea?.removeEventListener("input", handler);
			}
		};

		const unsubscribeOrgName = setupInputListener(nameInputRef, "orgName");
		const unsubscribeEmail = setupInputListener(emailInputRef, "email");
		const unsubscribeDescription = setupTextareaListener(descriptionRef, "description");
		const unsubscribeUrl = setupInputListener(urlInputRef, "url");

		return () => {
			unsubscribeOrgName?.();
			unsubscribeEmail?.();
			unsubscribeDescription?.();
			unsubscribeUrl?.();
		};
	}, [onFormChange, onClearError]);

	return (
		<div className="space-y-6">
			{error && <div className="bg-danger/10 border border-danger/20 rounded-lg p-4 text-sm text-danger">{error}</div>}

			<div className="space-y-2">
				<label htmlFor="orgName" className="block text-sm font-semibold text-text">
					Nombre de la Organización <span className="text-danger">*</span>
				</label>
				<adc-input
					ref={nameInputRef}
					inputId="orgName"
					name="orgName"
					type="text"
					placeholder="ej: ACME Corporation"
					value={formData.orgName}
				/>
				<p className="text-xs text-muted">Nombre que deseas para la organización (será revisado por un administrador)</p>
			</div>

			<div className="space-y-2">
				<label htmlFor="email" className="block text-sm font-semibold text-text">
					Email de Contacto <span className="text-danger">*</span>
				</label>
				<adc-input
					ref={emailInputRef}
					inputId="email"
					name="email"
					type="email"
					placeholder="contacto@tu-organizacion.com"
					value={formData.email}
				/>
				<p className="text-xs text-muted">Email para que el administrador se comunique con ustedes</p>
			</div>

			<div className="space-y-2">
				<label htmlFor="description" className="block text-sm font-semibold text-text">
					Descripción
				</label>
				<adc-textarea
					ref={descriptionRef}
					textareaId="description"
					name="description"
					placeholder="Describe brevemente tu organización y sus objetivos"
					value={formData.description}
					rows={4}
				/>
				<p className="text-xs text-muted">Máximo 2000 caracteres</p>
			</div>

			<div className="space-y-2">
				<label htmlFor="url" className="block text-sm font-semibold text-text">
					URL de la Organización
				</label>
				<adc-input
					ref={urlInputRef}
					inputId="url"
					name="url"
					type="url"
					placeholder="https://tu-organizacion.com"
					value={formData.url}
				/>
				<p className="text-xs text-muted">Opcional - Sitio web oficial de tu organización</p>
			</div>
		</div>
	);
}
