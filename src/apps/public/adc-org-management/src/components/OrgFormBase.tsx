interface FormData {
	orgName: string;
	email: string;
	description: string;
	url: string;
}

interface InputEventLike {
	readonly target: EventTarget | null;
}

interface OrgFormBaseProps {
	readonly formData: FormData;
	readonly error: string | null;
	readonly onFormChange: (field: keyof FormData, value: string) => void;
	readonly onClearError: () => void;
}

export function OrgFormBase({ formData, error, onFormChange, onClearError }: OrgFormBaseProps) {
	const handleInput = (field: keyof FormData, event: InputEventLike) => {
		const value = (event.target as HTMLInputElement | HTMLTextAreaElement).value;
		onFormChange(field, value);
		onClearError();
	};

	return (
		<div className="space-y-6">
			{error && <div className="bg-danger border border-danger rounded-lg p-4 text-sm text-tdanger">{error}</div>}

			<div className="space-y-2">
				<label htmlFor="orgName" className="block text-sm font-semibold text-text">
					Nombre de la Organización <span className="text-danger">*</span>
				</label>
				<adc-input
					inputId="orgName"
					name="orgName"
					type="text"
					placeholder="ej: ACME Corporation"
					value={formData.orgName}
					onInput={(event) => handleInput("orgName", event)}
				/>
				<p className="text-xs text-muted">Nombre que deseas para la organización (será revisado por un administrador)</p>
			</div>

			<div className="space-y-2">
				<label htmlFor="email" className="block text-sm font-semibold text-text">
					Email de Contacto <span className="text-danger">*</span>
				</label>
				<adc-input
					inputId="email"
					name="email"
					type="email"
					placeholder="contacto@tu-organizacion.com"
					value={formData.email}
					onInput={(event) => handleInput("email", event)}
				/>
				<p className="text-xs text-muted">Email para que el administrador se comunique con ustedes</p>
			</div>

			<div className="space-y-2">
				<label htmlFor="description" className="block text-sm font-semibold text-text">
					Descripción
				</label>
				<adc-textarea
					textareaId="description"
					name="description"
					placeholder="Describe brevemente tu organización y sus objetivos"
					value={formData.description}
					rows={4}
					onInput={(event) => handleInput("description", event)}
				/>
				<p className="text-xs text-muted">Máximo 2000 caracteres</p>
			</div>

			<div className="space-y-2">
				<label htmlFor="url" className="block text-sm font-semibold text-text">
					URL de la Organización
				</label>
				<adc-input
					inputId="url"
					name="url"
					type="url"
					placeholder="https://tu-organizacion.com"
					value={formData.url}
					onInput={(event) => handleInput("url", event)}
				/>
				<p className="text-xs text-muted">Opcional - Sitio web oficial de tu organización</p>
			</div>
		</div>
	);
}
