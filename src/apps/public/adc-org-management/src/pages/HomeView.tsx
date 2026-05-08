import React, { useState, useEffect } from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";
import { router } from "@common/utils/router.js";
import { orgApi } from "../utils/org-api.js";
import type { Organization } from "../utils/org-api.js";

/**
 * Vista home - Muestra las organizaciones del usuario
 */
export default function HomeView() {
	const { t } = useTranslation({ namespace: "adc-org-management", autoLoad: true });
	const [organizations, setOrganizations] = useState<Organization[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const loadOrganizations = async () => {
			try {
				const result = await orgApi.getUserOrganizations();
				if (result?.success && result.data?.organizations) {
					setOrganizations(result.data.organizations);
				}
				setError(null);
			} catch (err) {
				console.error("Error loading organizations:", err);
				setError(err instanceof Error ? err.message : "Error al cargar organizaciones");
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

	return (
		<div className="min-h-screen bg-background px-4 py-12">
			<div className="max-w-6xl mx-auto">
				{/* Header */}
				<div className="mb-12">
					<h1 className="text-4xl font-bold text-text mb-3">
						{t("home.title") || "Mis Organizaciones"}
					</h1>
					<p className="text-lg text-muted">
						{t("home.subtitle") || "Gestiona y configura tus organizaciones en ADC Platform"}
					</p>
				</div>

				{/* Error State */}
				{error && (
					<div className="bg-error/10 border border-error/20 rounded-lg p-4 mb-6">
						<p className="text-error text-sm">{error}</p>
					</div>
				)}

				{/* Empty State */}
				{!hasOrganizations ? (
					<div className="bg-surface rounded-xxl p-12 text-center border border-border shadow-sm">
						<div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6">
							<svg className="w-8 h-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5.581m0 0H9m5.581 0a2 2 0 100-4m0 4v2m0-6V9a2 2 0 10-4 0v6m4 0a2 2 0 100 4m0-4a2 2 0 110 4m0 0H9"
								/>
							</svg>
						</div>
						<h2 className="text-2xl font-bold text-text mb-3">
							{t("home.empty.title") || "No tienes organizaciones"}
						</h2>
						<p className="text-muted mb-8 max-w-md mx-auto">
							{t("home.empty.description") || "Crea tu primera organización para comenzar a colaborar con tu equipo"}
						</p>
						<adc-button type="button" onClick={() => router.navigate("/org-management/request")}>
							{t("home.empty.button") || "Crear Primera Organización"}
						</adc-button>
					</div>
				) : (
					<div>
						{/* Organizations Grid */}
						<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
							{organizations.map((org) => (
								<div
									key={org.orgId}
									className="bg-surface rounded-lg border border-border shadow-sm hover:shadow-md transition-shadow overflow-hidden"
								>
									<div className="p-6">
										{/* Org Header */}
										<div className="mb-4">
											<h3 className="text-lg font-bold text-text truncate">
												{org.metadata?.orgName || org.slug}
											</h3>
											<p className="text-sm text-muted">{org.slug}</p>
										</div>

										{/* Status Badge */}
										<div className="flex gap-2 mb-4">
											{org.approved ? (
												<span className="inline-block px-2 py-1 text-xs font-semibold rounded bg-success/10 text-success">
													Aprobada
												</span>
											) : (
												<span className="inline-block px-2 py-1 text-xs font-semibold rounded bg-warning/10 text-warning">
													Pendiente
												</span>
											)}
											<span
												className={`inline-block px-2 py-1 text-xs font-semibold rounded ${
													org.status === "active"
														? "bg-success/10 text-success"
														: org.status === "blocked"
															? "bg-error/10 text-error"
															: "bg-muted/10 text-muted"
												}`}
											>
												{org.status}
											</span>
										</div>

										{/* Description */}
										{org.metadata?.description && (
											<p className="text-sm text-muted line-clamp-2 mb-4">
												{org.metadata.description}
											</p>
										)}

										{/* Action Buttons */}
										<div className="flex gap-2">
											{org.approved ? (
												<adc-button
													type="button"
													variant="primary"
													onClick={() => router.navigate(`/organization/${org.slug}`)}
													class="flex-1"
												>
													Acceder al Panel
												</adc-button>
											) : (
												<adc-button
													type="button"
													variant="primary"
													disabled
													class="flex-1"
			
												>
													Pendiente de Aprobación
												</adc-button>
											)}
											{org.metadata?.url && (
												<adc-button
													type="button"
													variant="primary"
													onClick={() => window.open(org.metadata?.url, "_blank")}
													class="flex-1"
												>
													Sitio Web
												</adc-button>
											)}
										</div>
									</div>
								</div>
							))}
						</div>

						{/* Create New Button */}
						<div className="text-center">
							<adc-button type="button" onClick={() => router.navigate("/org-management/request")}>
								+ {t("home.createNew") || "Crear Nueva Organización"}
							</adc-button>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
