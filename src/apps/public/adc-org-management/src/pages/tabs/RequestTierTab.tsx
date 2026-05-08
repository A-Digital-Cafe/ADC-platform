import "@ui-library/utils/react-jsx";
import { useState } from "react";
import type { Organization } from "../../utils/org-api.js";

interface RequestTierTabProps {
	org: Organization;
}

const TIER_TYPES = [
	{ id: "basic", label: "Plan Básico", icon: "🚀", description: "Funcionalidades esenciales" },
	{ id: "professional", label: "Plan Profesional", icon: "⭐", description: "Características avanzadas" },
	{ id: "enterprise", label: "Plan Enterprise", icon: "👑", description: "Solución personalizada" },
	{ id: "support", label: "Soporte Premium", icon: "🛟", description: "Soporte dedicado" },
];

export default function RequestTierTab({ org }: RequestTierTabProps) {
	const [selectedTier, setSelectedTier] = useState<string | null>(null);
	const [description, setDescription] = useState("");
	const [submitted, setSubmitted] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleSubmit = async () => {
		if (!selectedTier || !description.trim()) {
			setError("Por favor completa todos los campos");
			return;
		}

		try {
			setLoading(true);
			setError(null);

			// TODO: Integrar con PM API para crear ticket
			// const ticket = await pmApi.createTicket({
			//   projectId: "org-tiers",
			//   title: `${TIER_TYPES.find(t => t.id === selectedTier)?.label} - ${org.name}`,
			//   description,
			//   metadata: {
			//     orgId: org.orgId,
			//     orgSlug: org.slug,
			//     tierType: selectedTier,
			//   }
			// });

			// Por ahora simular success
			console.log("📝 Solicitud de tier:", { org: org.slug, tier: selectedTier, description });
			setSubmitted(true);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Error al enviar la solicitud");
		} finally {
			setLoading(false);
		}
	};

	const handleReset = () => {
		setSelectedTier(null);
		setDescription("");
		setSubmitted(false);
		setError(null);
	};

	if (submitted) {
		return (
			<div className="space-y-6">
				<div className="text-center py-12">
					<div className="w-16 h-16 rounded-full bg-success/20 flex items-center justify-center mx-auto mb-4">
						<svg className="w-8 h-8 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M5 13l4 4L19 7"
							/>
						</svg>
					</div>
					<h2 className="text-2xl font-bold text-text mb-2">Solicitud Enviada</h2>
					<p className="text-muted mb-8 max-w-md mx-auto">
						Tu solicitud ha sido enviada correctamente. El equipo de ADC Platform revisará tu solicitud
						y se pondrá en contacto contigo pronto.
					</p>
					<adc-button type="button" onClick={handleReset}>
						Realizar Otra Solicitud
					</adc-button>
				</div>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			{/* Header */}
			<div>
				<h2 className="text-2xl font-bold text-text mb-1">Solicitud de Planes Pagos</h2>
				<p className="text-muted">Solicita un plan pagado para tu organización</p>
			</div>

			{/* Error */}
			{error && (
				<div className="bg-error/10 border border-error/20 rounded-lg p-4 text-sm text-error">
					{error}
				</div>
			)}

			{/* Tier Selection */}
			<div>
				<h3 className="font-semibold text-text mb-4">Selecciona el tipo de plan</h3>
				<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
					{TIER_TYPES.map((tier) => (
						<button
							key={tier.id}
							onClick={() => setSelectedTier(tier.id)}
							className={`p-6 rounded-lg border-2 transition-all text-left ${
								selectedTier === tier.id
									? "bg-primary/10 border-primary"
									: "bg-surface border-border hover:border-muted"
							}`}
						>
							<div className="text-3xl mb-3">{tier.icon}</div>
							<h4 className="font-semibold text-text mb-1">{tier.label}</h4>
							<p className="text-sm text-muted">{tier.description}</p>
						</button>
					))}
				</div>
			</div>

			{/* Description */}
			<div>
				<label className="block font-semibold text-text mb-2">
					Cuéntanos más sobre tu necesidad
				</label>
				<textarea
					value={description}
					onChange={(e) => setDescription(e.currentTarget.value)}
					placeholder="Describe por qué necesitas este plan y qué características son importantes para ti..."
					className="w-full p-4 border border-border rounded-lg bg-surface text-text placeholder-muted focus:outline-none focus:ring-2 focus:ring-primary resize-none"
					rows={6}
				/>
				<p className="text-xs text-muted mt-2">
					{description.length} / 500 caracteres
				</p>
			</div>

			{/* Organization Info */}
			<div className="bg-info/10 border border-info/20 rounded-lg p-4">
				<p className="text-sm text-text">
					<strong>Organización:</strong> {org.name} ({org.slug})
					<br />
					<strong>Email de contacto:</strong> {org.email}
				</p>
			</div>

			{/* Submit Button */}
			<div className="flex gap-3">
				<adc-button
					type="button"
					onClick={handleSubmit}
					disabled={loading || !selectedTier || !description.trim()}
				>
					{loading ? "Enviando..." : "Enviar Solicitud"}
				</adc-button>
				<adc-button
					type="button"
					onClick={handleReset}
					disabled={loading}
				>
					Cancelar
				</adc-button>
			</div>

			{/* Help Text */}
			<div className="bg-background rounded-lg p-4 border border-border text-sm text-muted">
				<p>
					💡 Una vez enviada tu solicitud, el equipo de ADC Platform la revisará y se contactará contigo
					para discutir los detalles y las opciones de precios.
				</p>
			</div>
		</div>
	);
}
