import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";
import { router } from "@common/utils/router.js";
import { getSession } from "@ui-library/utils/session";
import { orgApi } from "../utils/org-api.js";
import { canManageOrganizations } from "../utils/permissions.js";
import type { Organization } from "../utils/org-api.js";
import GeneralTab from "./tabs/GeneralTab";
import AppsTab from "./tabs/AppsTab";
import RequestTierTab from "./tabs/RequestTierTab";

type TabType = "general" | "apps" | "tiers";

interface OrganizationDashboardViewProps {
	slug: string;
}

/**
 * Vista del dashboard de organización
 * Solo el creador de la solicitud o admins pueden acceder a una org aprobada/activa
 */
export default function OrganizationDashboardView({ slug }: OrganizationDashboardViewProps) {
	const { t } = useTranslation({ namespace: "adc-org-management", autoLoad: true });
	const [org, setOrg] = useState<Organization | null>(null);
	const [loading, setLoading] = useState(true);
	const [accessDenied, setAccessDenied] = useState(false);
	const [activeTab, setActiveTab] = useState<TabType>("general");
	const sidebarRef = useRef<HTMLElement>(null);
	const buttonRef = useRef<HTMLElement>(null);
	const [sidebarExpanded, setSidebarExpanded] = useState(false);

	// Cargar sesión y organización
	useEffect(() => {
		const loadData = async () => {
			try {
				// Obtener sesión actual (force refresh)
				const session = await getSession(true);

				// Esperar un poco para que las cookies se actualicen
				await new Promise(resolve => setTimeout(resolve, 100));

				// Cargar organización
				const result = await orgApi.getOrganizationBySlug(slug);
				const orgData = (result as any)?.data as Organization | undefined;
				
				if (result?.success && orgData) {
					// Validar acceso:
					// - Admin siempre puede acceder
					// - El creador SIEMPRE puede acceder a su org (approved o no)
					// - Otros usuarios solo pueden acceder si org está aprobada
					const userIsAdmin = canManageOrganizations(session.user?.perms);
					const userIsCreator = orgData.createdByUserId && session.user?.id === orgData.createdByUserId;
					const isApproved = orgData.approved === true;
					
					console.log("🔍 [OrganizationDashboardView] Access check:", {
						slug,
						userId: session.user?.id,
						createdByUserId: orgData.createdByUserId,
						userIsAdmin,
						userIsCreator,
						isApproved,
					});
					
					// Acceso permitido si: es admin O es creador O (org está aprobada)
					const canAccess = userIsAdmin || userIsCreator || isApproved;
					
					if (!canAccess) {
						setAccessDenied(true);
						setOrg(null);
						return;
					}
					
					setOrg(orgData);
					setAccessDenied(false);
				} else {
					setOrg(null);
				}
			} catch (err) {
				console.error("Error loading data:", err);
				setAccessDenied(true);
				setOrg(null);
			} finally {
				setLoading(false);
			}
		};

		loadData();
	}, [slug]);

	const handleSidebarItemClick = useCallback((e: Event) => {
		const detail = (e as CustomEvent).detail;
		const tab = detail?.action as TabType;
		console.log("Sidebar item clicked:", { detail, tab });
		if (!tab) return;
		setActiveTab(tab);
		setSidebarExpanded(false);
	}, []);

	const handleExpandToggle = useCallback((e: Event) => {
		const isExpanded = (e as CustomEvent).detail;
		console.log("Expand toggle:", isExpanded);
		setSidebarExpanded(!!isExpanded);
	}, []);

	const sidebarItems = useMemo(
		() => {
			const items = [
				{
					label: t("tabs.general") || "General",
					iconSvg: `<svg class="w-6 h-6 mx-auto block" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`,
					action: "general",
				},
				{
					label: t("tabs.apps") || "Aplicaciones",
					iconSvg: `<svg class="w-6 h-6 mx-auto block" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"/></svg>`,
					action: "apps",
				},
			];
			
			// Todos pueden ver y solicitar tiers pagos
			items.push({
				label: t("tabs.tiers") || "Planes Pagos",
				iconSvg: `<svg class="w-6 h-6 mx-auto block" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>`,
				action: "tiers",
			});
			
			return items;
		},
		[t]
	);

	useEffect(() => {
		const sidebar = sidebarRef.current;
		const button = buttonRef.current;

		if (!sidebar || !button) return;

		sidebar.addEventListener("adcSidebarItemClick", handleSidebarItemClick);
		button.addEventListener("adcExpandToggle", handleExpandToggle);

		return () => {
			sidebar.removeEventListener("adcSidebarItemClick", handleSidebarItemClick);
			button.removeEventListener("adcExpandToggle", handleExpandToggle);
		};
	}, [handleSidebarItemClick, handleExpandToggle]);

	if (loading) {
		return (
			<div className="flex min-h-screen bg-background">
				<div className="w-full p-adc-lg">
					<adc-skeleton variant="rectangular" height="48px" class="mb-6" />
					<adc-skeleton variant="rectangular" height="400px" />
				</div>
			</div>
		);
	}

	if (accessDenied) {
		return (
			<div className="flex items-center justify-center min-h-screen bg-background">
				<div className="max-w-md mx-auto">
					<div className="bg-warning/10 border border-warning/20 rounded-lg p-8 text-center">
						<div className="w-16 h-16 rounded-full bg-warning/20 flex items-center justify-center mx-auto mb-4">
							<svg className="w-8 h-8 text-warning" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4v2m0 4v2m0-12a9 9 0 11-18 0 9 9 0 0118 0z" />
							</svg>
						</div>
						<h1 className="font-bold text-xl text-text mb-2">Acceso denegado</h1>
						<p className="text-muted text-sm mb-6">
							No tienes permiso para acceder a esta organización. 
							<br />
							<br />
							Posibles motivos:
							<br />
							• Tu solicitud aún está pendiente de aprobación
							<br />
							• Tu solicitud fue rechazada
							<br />
							• No eres el creador de esta organización
						</p>
						<adc-button type="button" onadcClick={() => router.navigate("/org-management")}>
							Volver al inicio
						</adc-button>
					</div>
				</div>
			</div>
		);
	}

	if (!org) {
		return (
			<div className="flex items-center justify-center min-h-screen">
				<adc-card className="p-adc-lg text-center">
					<h1 className="font-heading text-2xl font-bold text-text mb-4">{t("dashboard.notFound") || "Organización no encontrada"}</h1>
					<button
						onClick={() => router.navigate("/org-management")}
						className="px-adc-md py-adc-sm bg-primary text-white rounded-md hover:bg-primary/90"
					>
						{t("dashboard.back") || "Volver"}
					</button>
				</adc-card>
			</div>
		);
	}

	const renderActiveView = () => {
		switch (activeTab) {
			case "general":
				return <GeneralTab org={org} onUpdate={setOrg} />;
			case "apps":
				return <AppsTab org={org} />;
			case "tiers":
				return <RequestTierTab org={org} />;
			default:
				return null;
		}
	};

	return (
		<div className="flex min-h-screen bg-background">
			{/* Expand button */}
			<div
				className={`
					fixed top-1/2 z-50 lg:hidden
					-translate-y-1/2 transition-all duration-300
					${sidebarExpanded ? "left-70" : "left-22"}
				`}
			>
				<adc-button-expand ref={buttonRef} isExpanded={sidebarExpanded} />
			</div>

			{/* Sidebar */}
			<adc-sidebar
				ref={sidebarRef}
				items={sidebarItems}
				collapsed={!sidebarExpanded}
				activeItem={activeTab}
				title={org?.slug || "Organization"}
				subtitle={`ID: ${org?.orgId || "-"}`}
			/>

			{/* Main */}
			<main
				className={`
					flex-1 transition-all duration-300
					${sidebarExpanded ? "lg:ml-74" : "lg:mx-20"}
				`}
			>
				<div className="w-full p-adc-lg">
					<div className="animate-fade-in">{renderActiveView()}</div>
				</div>
			</main>
		</div>
	);
}
