import { useCallback, useState } from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";

interface Props {
	title: string;
	nameLabel?: string;
	descriptionLabel?: string;
	onClose: () => void;
	onSubmit: (values: { name: string; description: string }) => Promise<void> | void;
}

/**
 * Modal genérico con campos `name` + `description` (opcional).
 * Reutilizado por "crear sprint", "crear milestone", etc.
 */
export function SimpleCreateModal({ title, nameLabel, descriptionLabel, onClose, onSubmit }: Readonly<Props>) {
	const { t } = useTranslation({ namespace: "adc-project-manager" });
	const [form, setForm] = useState({ name: "", description: "" });

	const modalRef = useCallback(
		(el: HTMLElement | null) => {
			if (el) el.addEventListener("adcClose", onClose);
		},
		[onClose]
	);

	const handleSave = async () => {
		if (!form.name) return;
		await onSubmit(form);
	};

	return (
		<adc-modal ref={modalRef} open modalTitle={title} size="md">
			<div className="space-y-3 p-4 min-w-80">
				<div>
					<label className="block text-sm font-medium mb-1 text-text">{nameLabel ?? t("common.name")}</label>
					<adc-input value={form.name} onInput={(e: any) => setForm({ ...form, name: e.target.value })} />
				</div>
				<div>
					<label className="block text-sm font-medium mb-1 text-text">{descriptionLabel ?? t("common.description")}</label>
					<adc-input value={form.description} onInput={(e: any) => setForm({ ...form, description: e.target.value })} />
				</div>
				<div className="flex gap-2 justify-end pt-2">
					<adc-button variant="accent" onClick={onClose}>
						{t("common.cancel")}
					</adc-button>
					<adc-button variant="primary" onClick={handleSave}>
						{t("common.save")}
					</adc-button>
				</div>
			</div>
		</adc-modal>
	);
}
