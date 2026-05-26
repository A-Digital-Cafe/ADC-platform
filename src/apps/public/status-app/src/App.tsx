import React, { useRef, useEffect, useCallback, useState } from "react";
import "@ui-library/utils/react-jsx";
import { router } from "@common/utils/router.js";
import { getSession } from "@ui-library/utils/session";
import { useTranslation } from "@ui-library/utils/i18n-react";
import StatusView from "./pages/StatusView";
import TicketsView from "./pages/TicketsView";
import MetricsView from "./pages/MetricsView";
import CompatibilityView from "./pages/CompatibilityView";

type StatusSection = "status" | "tickets" | "metrics" | "compatibility";

const DEFAULT_SECTION: StatusSection = "status";
const SECTIONS = {
	status: {
		labelKey: "nav.status",
		icon: `<svg class="w-6 h-6 mx-auto block" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>`,
		component: StatusView,
	},
	tickets: {
		labelKey: "nav.tickets",
		icon: `<svg class="w-6 h-6 mx-auto block" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>`,
		component: TicketsView,
	},
	metrics: {
		labelKey: "nav.metrics",
		icon: `<svg class="w-6 h-6 mx-auto block" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>`,
		component: MetricsView,
	},
	compatibility: {
		labelKey: "nav.compatibility",
		icon: `<svg class="w-6 h-6 mx-auto block" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20m0 0l-.75 3m.75-3h5.25m0 0l.75 3m0 0l.75-3m-8.25-4h4.5m0 0h4.5m0 0V6a1 1 0 00-1-1h-2.5a1 1 0 00-1 1v6m0 0H9m4 0H9m8-6V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v6h10z"/></svg>`,
		component: CompatibilityView,
	},
} as const;

function getSectionFromPath(path: string): StatusSection {
	const match = /^\/status\/([^/]+)/.exec(path);
	const section = match?.[1] as StatusSection;
	return SECTIONS[section] ? section : DEFAULT_SECTION;
}

export default function App() {
	const { t } = useTranslation({ namespace: "status-app", autoLoad: true });
	const sidebarRef = useRef<HTMLElement>(null);
	const buttonRef = useRef<HTMLElement>(null);

	const [currentPath, setCurrentPath] = useState(router.getCurrentPath() || "/status/status");
	const [sidebarExpanded, setSidebarExpanded] = useState(false);
	const [sessionChecked, setSessionChecked] = useState(false);
	const [authenticated, setAuthenticated] = useState(false);

	useEffect(() => {
		getSession(true).then((s) => {
			setAuthenticated(s.authenticated);
			setSessionChecked(true);
		});
	}, []);

	useEffect(() => {
		return router.setOnRouteChange(setCurrentPath);
	}, []);

	const activeSection = getSectionFromPath(currentPath);
	const ActiveComponent = SECTIONS[activeSection].component;

	const handleSidebarItemClick = useCallback((e: Event) => {
		const action = (e as CustomEvent).detail?.action;
		if (!action) return;

		router.navigate(`/status/${action}`);
		setSidebarExpanded(false);
	}, []);

	const handleExpandToggle = useCallback((e: Event) => {
		setSidebarExpanded(!!(e as CustomEvent).detail);
	}, []);

	useEffect(() => {
		if (!sessionChecked || !authenticated) return;

		const sidebar = sidebarRef.current;
		const button = buttonRef.current;

		if (!sidebar && !button) return;

		sidebar?.addEventListener("adcSidebarItemClick", handleSidebarItemClick);
		button?.addEventListener("adcExpandToggle", handleExpandToggle);

		return () => {
			sidebar?.removeEventListener("adcSidebarItemClick", handleSidebarItemClick);
			button?.removeEventListener("adcExpandToggle", handleExpandToggle);
		};
	}, [handleSidebarItemClick, handleExpandToggle, sessionChecked, authenticated]);

	let render: React.ReactNode;
	if (sessionChecked) {
		if (authenticated)
			render = (
				<div className="flex min-h-screen bg-background">
					<div
						className={`
					fixed top-1/2 z-50 lg:hidden
					-translate-y-1/2 transition-all duration-300
					${sidebarExpanded ? "left-70" : "left-22"}
				`}
					>
						<adc-button-expand ref={buttonRef} isExpanded={sidebarExpanded} />
					</div>

					<adc-sidebar
						ref={sidebarRef}
						items={Object.entries(SECTIONS).map(([key, value]) => ({
							label: t(value.labelKey),
							iconSvg: value.icon,
							action: key,
						}))}
						collapsed={!sidebarExpanded}
						activeItem={activeSection}
						title={t("nav.title")}
					/>

					<main
						className={`
					flex-1 transition-all duration-300
					${sidebarExpanded ? "lg:ml-74" : "lg:mx-20"}
				`}
					>
						<div className="w-full p-adc-lg">
							<div className="animate-fade-in">
								<ActiveComponent />
							</div>
						</div>
					</main>
				</div>
			);
		else
			render = (
				<div className="max-w-3xl mx-auto px-4 py-16 text-center">
					<h1 className="font-heading text-2xl font-bold text-text mb-4">{t("auth.accessRequired")}</h1>
					<p className="text-muted">{t("auth.signInRequired")}</p>
				</div>
			);
	} else
		render = (
			<div className="max-w-3xl mx-auto px-4 py-8">
				<adc-skeleton variant="rectangular" height="48px" class="mb-6" />
				<adc-skeleton variant="rectangular" height="400px" />
			</div>
		);
	return <adc-layout>{render}</adc-layout>;
}
