import "@ui-library/utils/react-jsx";
import { useState, useEffect } from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";
import { router } from "@common/utils/router.js";
import { clearErrors } from "@ui-library/utils/adc-fetch";
import { getSession } from "@ui-library/utils/session";

import OrgRequestView from "./pages/OrgRequestView";
import HomeView from "./pages/HomeView";
import LandingView from "./pages/LandingView";
import { AuthGate } from "./components/AuthGate.js";

type ViewType = "home" | "request";

function parseRoute(path: string): { view: ViewType } {
	const cleanPath = path.replace(/^\/+/, "").split("?")[0];

	if (cleanPath.includes("request")) {
		return { view: "request" };
	}

	return { view: "home" };
}

export default function App() {
	const { t, ready } = useTranslation({ namespace: "adc-org-management", autoLoad: true });
	const [currentPath, setCurrentPath] = useState(router.getCurrentPath() || "/org-management");
	const [sessionReady, setSessionReady] = useState(false);
	const [isAuthenticated, setIsAuthenticated] = useState(false);

	const route = parseRoute(currentPath);

	useEffect(() => {
		return router.setOnRouteChange((newPath) => {
			setCurrentPath(newPath);
		});
	}, []);

	useEffect(() => {
		const loadSession = async () => {
			clearErrors();
			try {
				const session = await getSession(true);
				setIsAuthenticated(!!session?.user?.id);
			} catch {
				setIsAuthenticated(false);
			} finally {
				setSessionReady(true);
			}
		};

		loadSession();
	}, []);

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
				{!isAuthenticated && sessionReady ? (
					<LandingView />
				) : (
					<div className="w-full">
						{route.view === "home" && (
							<AuthGate>
								<HomeView />
							</AuthGate>
						)}
						{route.view === "request" && (
							<AuthGate>
								<OrgRequestView />
							</AuthGate>
						)}
					</div>
				)}
			</div>
		</adc-layout>
	);
}
