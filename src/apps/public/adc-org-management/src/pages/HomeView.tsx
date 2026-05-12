import React, { useState, useEffect } from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";
import { router } from "@common/utils/router.js";
import { orgApi } from "../utils/org-api.js";
import type { Organization } from "../utils/org-api.js";
import { OrgRequestForm } from "../components/OrgRequestForm.js";

/**
 * Vista home - Muestra las organizaciones del usuario
 */
export default function HomeView() {
	const { t } = useTranslation({ namespace: "adc-org-management", autoLoad: true });
	const [organizations, setOrganizations] = useState<Organization[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

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

	useEffect(() => {
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
					<h1 className="text-4xl font-bold text-text mb-3">{t("home.title") || "Mis Organizaciones"}</h1>
					<p className="text-lg text-muted">{t("home.subtitle") || "Gestiona y configura tus organizaciones en ADC Platform"}</p>
				</div>

				{/* Request Form - Always visible */}
				<div className="mb-12 p-8 bg-surface rounded-xxl border border-border shadow-sm">
					<h2 className="text-2xl font-bold text-text mb-2">{t("home.requestNew")}</h2>
					<p className="text-muted text-sm mb-6">{t("home.requestNewDescription")}</p>
					<OrgRequestForm onSuccess={loadOrganizations} />
				</div>

				{/* Error State */}
				{error && (
					<div className="bg-error/10 border border-error/20 rounded-lg p-4 mb-6">
						<p className="text-error text-sm">{error}</p>
					</div>
				)}

				{/* Organizations Section */}
				{hasOrganizations && (
					<div>
						<h2 className="text-2xl font-bold text-text mb-6">{t("home.myOrganizations") || "Mis Organizaciones"}</h2>
						{/* Organizations Grid */}
						<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
							{organizations.map((org) => (
								<div
									key={org.orgId}
									className="bg-surface rounded-lg border border-border shadow-sm hover:shadow-md transition-shadow overflow-hidden"
								>
									<div className="p-6">
										{/* Org Header */}
										<div className="mb-4">
											<h3 className="text-lg font-bold text-text truncate">{org.metadata?.orgName || org.slug}</h3>
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
											<p className="text-sm text-muted line-clamp-2 mb-4">{org.metadata.description}</p>
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
												<adc-button type="button" variant="primary" disabled class="flex-1">
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
					</div>
				)}
			</div>
		</div>
	);
}
