import React, { useRef, useEffect } from "react";

interface FormData {
	orgName: string;
	email: string;
	description: string;
	url: string;
}

interface OrgFormBaseProps {
	formData: FormData;
	error: string | null;
	onFormChange: (field: keyof FormData, value: string) => void;
	onClearError: () => void;
}

/**
 * Componente de formulario base para datos de organización
 * Maneja: nombre, email, descripción y URL
 */
export const OrgFormBase: React.FC<OrgFormBaseProps> = ({
	formData,
	error,
	onFormChange,
	onClearError,
}) => {
	const nameInputRef = useRef<any>(null);
	const emailInputRef = useRef<any>(null);
	const descriptionRef = useRef<any>(null);
	const urlInputRef = useRef<any>(null);

	// Setup event listeners for adc-input components
	useEffect(() => {
		const setupInputListener = (ref: React.RefObject<any>, field: keyof FormData) => {
			if (ref.current) {
				const handler = (e: CustomEvent<string>) => {
					onFormChange(field, e.detail);
					onClearError();
				};
				ref.current.addEventListener("adcChange", handler);
				return () => ref.current?.removeEventListener("adcChange", handler);
			}
		};

		const unsubscribeOrgName = setupInputListener(nameInputRef, "orgName");
		const unsubscribeEmail = setupInputListener(emailInputRef, "email");
		const unsubscribeDescription = setupInputListener(descriptionRef, "description");
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
			{/* Error Alert */}
			{error && <div className="bg-danger/10 border border-danger/20 rounded-lg p-4 text-sm text-danger">{error}</div>}

			{/* Organization Name Field */}
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

			{/* Email Field */}
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

			{/* Description Field */}
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
				<p className="text-xs text-muted">Máximo 500 caracteres</p>
			</div>

			{/* URL Field */}
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
};
