import React, { useState } from "react";
import { router } from "@common/utils/router.js";
import { orgApi } from "../utils/org-api.js";
import { toast } from "../utils/toast.js";
import type { SocialNetwork } from "../utils/org-api.js";
import { OrgFormBase } from "../components/OrgFormBase.js";
import { SocialNetworksManager } from "../components/SocialNetworksManager.js";
import { OrgRequestSuccess } from "../components/OrgRequestSuccess.js";

interface FormData {
	orgName: string;
	email: string;
	description: string;
	url: string;
}

/**
 * Vista de solicitud de creación de organización
 * Orquesta los componentes de formulario, redes sociales y pantalla de éxito
 */
export default function OrgRequestView() {
	const [formData, setFormData] = useState<FormData>({
		orgName: "",
		email: "",
		description: "",
		url: "",
	});

	const [socialNetworks, setSocialNetworks] = useState<Omit<SocialNetwork, "icon">[]>([]);
	const [submitted, setSubmitted] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

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
				platform: "twitter",
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
			const msg = "Por favor ingresa el nombre de la organización";
			setError(msg);
			toast.error(msg);
			setLoading(false);
			return;
		}

		if (formData.orgName.trim().length < 3) {
			const msg = "El nombre debe tener al menos 3 caracteres";
			setError(msg);
			toast.error(msg);
			setLoading(false);
			return;
		}

		// Validar email
		if (!formData.email.trim()) {
			const msg = "Por favor ingresa tu email";
			setError(msg);
			toast.error(msg);
			setLoading(false);
			return;
		}

		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		if (!emailRegex.test(formData.email)) {
			const msg = "Por favor ingresa un email válido";
			setError(msg);
			toast.error(msg);
			setLoading(false);
			return;
		}

		// Validar URL (opcional)
		if (formData.url.trim()) {
			// Si tiene contenido, validar que sea un URL válido
			try {
				new URL(formData.url);
			} catch {
				const msg = "Por favor ingresa una URL válida (ej: https://tu-org.com)";
				setError(msg);
				toast.error(msg);
				setLoading(false);
				return;
			}
		}

		try {
			// Llamar al endpoint de Identity que crea el ticket en PM
			const result = await orgApi.requestOrganization({
				name: formData.orgName,
				email: formData.email,
				description: formData.description,
				url: formData.url,
				socialNetworks: socialNetworks.length > 0 ? socialNetworks : undefined,
			});

			// El endpoint devuelve { success, ticketId, ticketKey, message }
			if ((result as any)?.data?.success || (result as any)?.success) {
				// Mostrar pantalla de éxito - admin aprobará el ticket en PM
				setSubmitted(true);
				return;
			}

			toast.error("Error al enviar la solicitud");
			setLoading(false);
		} catch (err) {
			console.error("❌ Error al enviar:", err);
			const errorMsg = err instanceof Error ? err.message : "Error al enviar la solicitud";
			setError(errorMsg);
			toast.error(errorMsg);
			setLoading(false);
		}
	};

	// Success handlers
	const handleGoHome = () => {
		router.navigate("/org-management");
	};

	const handleCreateAnother = () => {
		setSubmitted(false);
		setFormData({ orgName: "", email: "", description: "", url: "" });
		setSocialNetworks([]);
		setError(null);
	};

	return (
		<div className="min-h-screen bg-background px-4 py-12">
			<div className="max-w-2xl mx-auto">
				{/* Header */}
				<div className="text-center mb-12">
					<h1 className="text-4xl font-bold text-text mb-3">Crear Nueva Organización</h1>
					<p className="text-lg text-muted">Configura tu organización y comienza a colaborar con tu equipo en ADC Platform</p>
				</div>

				{/* Form Container */}
				<div className="bg-surface rounded-xxl p-8 shadow-sm border border-border">
					{submitted ? (
						<OrgRequestSuccess onGoHome={handleGoHome} onCreateAnother={handleCreateAnother} />
					) : (
						<form onSubmit={handleSubmit} className="space-y-6">
							<OrgFormBase
								formData={formData}
								error={error}
								onFormChange={handleFormChange}
								onClearError={handleClearError}
							/>

							<SocialNetworksManager
								socialNetworks={socialNetworks}
								onAddSocialNetwork={handleAddSocialNetwork}
								onRemoveSocialNetwork={handleRemoveSocialNetwork}
								onSocialNetworkChange={handleSocialNetworkChange}
							/>

							{/* Info Box */}
							<div className="bg-info/10 border border-info/20 rounded-lg p-4 flex gap-3">
								<div className="text-lg">ℹ️</div>
								<div>
									<p className="text-sm text-text">
										Podrás invitar miembros a tu organización después de crearla, y configurar aplicaciones específicas según
										tus necesidades.
									</p>
								</div>
							</div>

							{/* Buttons */}
							<div className="flex gap-3 pt-4">
								<adc-button type="button" onClick={() => router.navigate("/")} class="flex-1">
									Cancelar
								</adc-button>
								<adc-button type="button" onClick={handleSubmit} disabled={loading} class="flex-1">
									{loading ? "Enviando..." : "Crear Organización"}
								</adc-button>
							</div>
						</form>
					)}
				</div>

				{/* Info Cards */}
				<div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-12">
					<div className="bg-surface rounded-xl p-6 border border-border">
						<div className="text-3xl mb-3">👥</div>
						<h3 className="font-semibold text-text mb-2">Colaboración</h3>
						<p className="text-sm text-muted">Invita a tu equipo y gestiona permisos</p>
					</div>

					<div className="bg-surface rounded-xl p-6 border border-border">
						<div className="text-3xl mb-3">⚙️</div>
						<h3 className="font-semibold text-text mb-2">Aplicaciones</h3>
						<p className="text-sm text-muted">Configura las apps que necesitas</p>
					</div>

					<div className="bg-surface rounded-xl p-6 border border-border">
						<div className="text-3xl mb-3">📊</div>
						<h3 className="font-semibold text-text mb-2">Análitica</h3>
						<p className="text-sm text-muted">Monitorea el desempeño de tu org</p>
					</div>
				</div>
			</div>
		</div>
	);
}
