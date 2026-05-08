import React, { useState, useEffect } from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";
import { router } from "@common/utils/router.js";
import { orgApi } from "../utils/org-api.js";
import type { Organization } from "../utils/org-api.js";

/**
 * Vista introductoria - Bienvenida para usuarios sin organizaciones
 * O panel de acceso rápido si ya tienen organizaciones
 */
export default function IntroView() {
	const { t } = useTranslation({ namespace: "adc-org-management", autoLoad: true });
	const [loading, setLoading] = useState(true);
	const [organizations, setOrganizations] = useState<Organization[]>([]);

	useEffect(() => {
		const loadOrganizations = async () => {
			try {
				const result = await orgApi.getUserOrganizations();
				if (result?.success && result.data?.organizations) {
					setOrganizations(result.data.organizations);
				}
			} catch (err) {
				console.error("Error loading organizations:", err);
			} finally {
				setLoading(false);
			}
		};

		loadOrganizations();
	}, []);

	if (loading) {
		return (
			<div className="min-h-screen bg-background flex items-center justify-center">
				<div className="text-center">
					<div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary mb-4" />
					<p className="text-muted">{t("common.loading") || "Cargando..."}</p>
				</div>
			</div>
		);
	}

	const hasOrganizations = organizations.length > 0;

	// Vista para usuarios que YA TIENEN organizaciones
	if (hasOrganizations) {
		return (
			<div className="min-h-screen bg-gradient-to-br from-background via-background to-success/5">
				<div className="px-4 py-20">
					<div className="max-w-2xl mx-auto text-center">
						{/* Success Icon */}
						<div className="mb-8 flex justify-center">
							<div className="w-24 h-24 rounded-full bg-success/10 flex items-center justify-center">
								<svg className="w-12 h-12 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth={1.5}
										d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
									/>
								</svg>
							</div>
						</div>

						{/* Title */}
						<h1 className="text-4xl md:text-5xl font-bold text-text mb-6">¡Bienvenido de vuelta!</h1>

						{/* Subtitle */}
						<p className="text-lg md:text-xl text-muted mb-12 max-w-xl mx-auto leading-relaxed">
							Ya tienes {organizations.length} {organizations.length === 1 ? "organización" : "organizaciones"} creada
							{organizations.length === 1 ? "" : "s"} en ADC Platform.
						</p>

						{/* Organizations List */}
						<div className="mb-12 space-y-3">
							{organizations.map((org) => (
								<div
									key={org.orgId}
									className="bg-surface rounded-lg border border-border p-4 flex items-center justify-between hover:bg-surface/80 transition-colors"
								>
									<div className="text-left flex-1">
										<h3 className="font-semibold text-text">{org.name || org.slug}</h3>
										<p className="text-sm text-muted">{org.slug}</p>
									</div>
									<svg className="w-5 h-5 text-success" fill="currentColor" viewBox="0 0 20 20">
										<path
											fillRule="evenodd"
											d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
											clipRule="evenodd"
										/>
									</svg>
								</div>
							))}
						</div>

						{/* CTA Buttons */}
						<div className="flex flex-col sm:flex-row gap-3 justify-center mb-8">
							<adc-button
								type="button"
								onClick={() => router.navigate("/org-management/home")}
								class="inline-block"
								variant="primary"
							>
								<span>Ir al Panel de Organizaciones</span>
							</adc-button>
							<adc-button type="button" onClick={() => router.navigate("/org-management/request")} class="inline-block">
								<span>Crear Nueva Organización</span>
							</adc-button>
						</div>
					</div>
				</div>
			</div>
		);
	}

	// Vista ORIGINAL para usuarios SIN organizaciones
	return (
		<div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
			{/* Hero Section */}
			<div className="px-4 py-20">
				<div className="max-w-4xl mx-auto text-center">
					{/* Logo/Icon */}
					<div className="mb-8 flex justify-center">
						<div className="w-24 h-24 rounded-full bg-primary/10 flex items-center justify-center">
							<svg className="w-12 h-12 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={1.5}
									d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5.581m0 0H9m5.581 0a2 2 0 100-4m0 4v2m0-6V9a2 2 0 10-4 0v6m4 0a2 2 0 100 4m0-4a2 2 0 110 4m0 0H9"
								/>
							</svg>
						</div>
					</div>

					{/* Title */}
					<h1 className="text-5xl md:text-6xl font-bold text-text mb-6">
						Bienvenido a<br />
						<span className="bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">ADC Platform</span>
					</h1>

					{/* Subtitle */}
					<p className="text-xl md:text-2xl text-muted mb-12 max-w-2xl mx-auto leading-relaxed">
						Crea y gestiona organizaciones de forma simple y segura. Colabora con tu equipo, organiza proyectos y escala tu negocio.
					</p>

					{/* Features Grid */}
					<div className="grid md:grid-cols-3 gap-6 mb-12">
						<div className="bg-surface rounded-lg border border-border p-6 shadow-sm">
							<div className="w-12 h-12 rounded-lg bg-success/10 flex items-center justify-center mb-4 mx-auto">
								<svg className="w-6 h-6 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
								</svg>
							</div>
							<h3 className="font-bold text-text mb-2">Rápido y Fácil</h3>
							<p className="text-sm text-muted">Crea tu organización en segundos con nuestro proceso simplificado</p>
						</div>

						<div className="bg-surface rounded-lg border border-border p-6 shadow-sm">
							<div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4 mx-auto">
								<svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth={2}
										d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
									/>
								</svg>
							</div>
							<h3 className="font-bold text-text mb-2">Seguro</h3>
							<p className="text-sm text-muted">Tus datos están protegidos con las mejores prácticas de seguridad</p>
						</div>

						<div className="bg-surface rounded-lg border border-border p-6 shadow-sm">
							<div className="w-12 h-12 rounded-lg bg-warning/10 flex items-center justify-center mb-4 mx-auto">
								<svg className="w-6 h-6 text-warning" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth={2}
										d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
									/>
								</svg>
							</div>
							<h3 className="font-bold text-text mb-2">Colaborativo</h3>
							<p className="text-sm text-muted">Invita a tu equipo y colabora en tiempo real en tus proyectos</p>
						</div>
					</div>

					{/* CTA Button */}
					<div className="mb-12">
						<adc-button type="button" onClick={() => router.navigate("/org-management/request")} class="inline-block">
							<span className="text-lg">Crear Mi Primera Organización</span>
						</adc-button>
					</div>
				</div>
			</div>

			{/* Features Section */}
			<div className="bg-surface/30 backdrop-blur-sm border-t border-border px-4 py-16">
				<div className="max-w-4xl mx-auto">
					<h2 className="text-3xl font-bold text-text mb-12 text-center">¿Qué puedes hacer?</h2>
					<div className="grid md:grid-cols-2 gap-8">
						<div className="flex gap-4">
							<div className="flex-shrink-0">
								<div className="flex items-center justify-center h-8 w-8 rounded-lg bg-primary/10">
									<span className="text-primary font-bold">1</span>
								</div>
							</div>
							<div>
								<h3 className="font-bold text-text mb-2">Crea tu organización</h3>
								<p className="text-muted text-sm">
									Proporciona información básica y envía tu solicitud. Será revisada por nuestro equipo.
								</p>
							</div>
						</div>

						<div className="flex gap-4">
							<div className="flex-shrink-0">
								<div className="flex items-center justify-center h-8 w-8 rounded-lg bg-primary/10">
									<span className="text-primary font-bold">2</span>
								</div>
							</div>
							<div>
								<h3 className="font-bold text-text mb-2">Aprobación</h3>
								<p className="text-muted text-sm">
									Una vez aprobada, recibirás confirmación por email y acceso inmediato al panel.
								</p>
							</div>
						</div>

						<div className="flex gap-4">
							<div className="flex-shrink-0">
								<div className="flex items-center justify-center h-8 w-8 rounded-lg bg-primary/10">
									<span className="text-primary font-bold">3</span>
								</div>
							</div>
							<div>
								<h3 className="font-bold text-text mb-2">Configura tu organización</h3>
								<p className="text-muted text-sm">Personaliza tu organización, invita miembros y comienza a colaborar.</p>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
