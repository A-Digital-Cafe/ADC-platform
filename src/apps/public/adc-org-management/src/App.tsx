import "@ui-library/utils/react-jsx";
import React, { useState, useEffect } from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";
import { router } from "@common/utils/router.js";
import { clearErrors } from "@ui-library/utils/adc-fetch";
import { getSession } from "@ui-library/utils/session";

// Pages

import OrgRequestView from "./pages/OrgRequestView";
import OrganizationDashboardView from "./pages/OrganizationDashboardView";
import HomeView from "./pages/HomeView";

// API
import { orgApi } from "./utils/org-api.js";

// Components
import { AuthGate } from "./components/AuthGate.js";

type ViewType = "home" | "request" | "dashboard" | "notfound";

function parseRoute(path: string): { view: ViewType; slug?: string } {
	const cleanPath = path.replace(/^\/+/, "").split("?")[0];

	if (cleanPath.includes("request")) {
		return { view: "request" };
	}

	const match = /^organization\/([^/]+)/.exec(cleanPath);
	if (match?.[1]) {
		return { view: "dashboard", slug: match[1] };
	}

	// Home o intro
	return { view: "home" };
}

export default function App() {
	const { t, ready } = useTranslation({ namespace: "adc-org-management", autoLoad: true });
	const [currentPath, setCurrentPath] = useState(router.getCurrentPath() || "/org-management");
	const [sessionReady, setSessionReady] = useState(false);
	const [userOrganizations, setUserOrganizations] = useState<any[] | null>(null);
	const [loadingOrgs, setLoadingOrgs] = useState(false);

	const route = parseRoute(currentPath);
	const isAtHome = route.view === "home";
	const hasOrganizations = userOrganizations && userOrganizations.length > 0;

	// Sincronizar con router
	useEffect(() => {
		return router.setOnRouteChange((newPath) => {
			setCurrentPath(newPath);
		});
	}, []);

	// Cargar sesión
	useEffect(() => {
		const loadSession = async () => {
			clearErrors();
			try {
				await getSession(true);
			} catch (err) {
				console.error("Error loading session:", err);
			} finally {
				setSessionReady(true);
			}
		};

		loadSession();
	}, []);

	// Cargar organizaciones cuando está en home
	useEffect(() => {
		if (!isAtHome || !sessionReady) return;

		const loadOrganizations = async () => {
			try {
				setLoadingOrgs(true);
				const result = await orgApi.getUserOrganizations();
				if (result?.success && result.data?.organizations) {
					setUserOrganizations(result.data.organizations);
				} else {
					setUserOrganizations([]);
				}
			} catch (err) {
				console.error("Error loading organizations:", err);
				setUserOrganizations([]);
			} finally {
				setLoadingOrgs(false);
			}
		};

		loadOrganizations();
	}, [isAtHome, sessionReady]);

	if (!ready || !sessionReady) {
		return (
			<div className="flex items-center justify-center min-h-screen">
				<div className="text-center">
					<div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
					<p className="mt-2 text-muted">{t("common.loading") || "Cargando..."}</p>
				</div>
			</div>
		);
	}

	return (
		<adc-layout>
			<adc-toast-manager></adc-toast-manager>
			<div className="w-full">
				{route.view === "home" && (
					<AuthGate>
						{loadingOrgs ? (
							<div className="flex items-center justify-center min-h-screen">
								<div className="text-center">
									<div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary mb-4" />
									<p className="text-muted">{t("common.loading") || "Cargando..."}</p>
								</div>
							</div>
						) : hasOrganizations ? (
							<HomeView />
						) : (
							<OrgRequestView />
						)}
					</AuthGate>
				)}
				{route.view === "request" && (
					<AuthGate>
						<OrgRequestView />
					</AuthGate>
				)}
				{route.view === "dashboard" && route.slug && (
					<AuthGate>
						<OrganizationDashboardView slug={route.slug} />
					</AuthGate>
				)}
				{route.view === "notfound" && (
					<div className="flex items-center justify-center min-h-screen">
						<div className="text-center">
							<h1 className="text-3xl font-bold mb-2">Página no encontrada</h1>
							<p className="text-muted mb-4">La ruta no existe</p>
							<button
								onClick={() => router.navigate("/org-management")}
								className="px-4 py-2 bg-primary text-white rounded hover:bg-primary/90"
							>
								Volver al inicio
							</button>
						</div>
					</div>
				)}
			</div>
		</adc-layout>
	);
}
