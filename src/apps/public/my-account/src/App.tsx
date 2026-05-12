import React, { useRef, useEffect, useCallback, useState } from "react";
import "@ui-library/utils/react-jsx";
import { router } from "@common/utils/router.js";
import { getSession } from "@ui-library/utils/session";
import ProfileView from "./pages/ProfileView";
import NotificationsView from "./pages/NotificationView";
import PrivacySecurityView from "./pages/PrivacySecurityView";
import AppearanceView from "./pages/AppearanceView";
import AdminView from "./pages/AdminView";

type SettingsSection = "profile" | "notifications" | "privacy-security" | "appearance" | "admin";

const DEFAULT_SECTION: SettingsSection = "profile";
const SECTIONS = {
	profile: {
		label: "Perfil",
		icon: `<svg class="w-6 h-6 mx-auto block" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"/></svg>`,
		component: ProfileView,
	},
	notifications: {
		label: "Notificaciones",
		icon: `<svg class="w-6 h-6 mx-auto block" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0a3 3 0 11-6 0m6 0H9"/></svg>`,
		component: NotificationsView,
	},
	"privacy-security": {
		label: "Privacidad y Seguridad",
		icon: `<svg class="w-6 h-6 mx-auto block" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>`,
		component: PrivacySecurityView,
	},
	appearance: {
		label: "Apariencia",
		icon: `<svg class="w-6 h-6 mx-auto block" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232a2.5 2.5 0 013.536 3.536l-8.486 8.486a4.5 4.5 0 01-2.121 1.171L5 20l.575-3.06a4.5 4.5 0 011.171-2.121l8.486-8.486zm1.768-1.768a4 4 0 00-5.657 0l-1.179 1.179 5.657 5.657 1.179-1.179a4 4 0 000-5.657z"/></svg>`,
		component: AppearanceView,
	},
	admin: {
		label: "Administración",
		icon: `<svg class="w-6 h-6 mx-auto block" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>`,
		component: AdminView,
	},
} as const;

function getSectionFromPath(path: string): SettingsSection {
	const match = /^\/settings\/([^/]+)/.exec(path);
	const section = match?.[1] as SettingsSection;
	return SECTIONS[section] ? section : DEFAULT_SECTION;
}

export default function App() {
	const sidebarRef = useRef<HTMLElement>(null);
	const buttonRef = useRef<HTMLElement>(null);

	const [currentPath, setCurrentPath] = useState(router.getCurrentPath() || "/settings/profile");
	const [sidebarExpanded, setSidebarExpanded] = useState(false);
	const [sessionChecked, setSessionChecked] = useState(false);
	const [authenticated, setAuthenticated] = useState(false);

	// Verificar sesión al montar (igual que adc-project-manager / adc-identity)
	useEffect(() => {
		getSession(true).then((s) => {
			setAuthenticated(s.authenticated);
			setSessionChecked(true);
		});
	}, []);

	// 🔁 sync con router
	useEffect(() => {
		return router.setOnRouteChange(setCurrentPath);
	}, []);

	const activeSection = getSectionFromPath(currentPath);
	const ActiveComponent = SECTIONS[activeSection].component;

	// navegación desde sidebar
	const handleSidebarItemClick = useCallback((e: Event) => {
		const action = (e as CustomEvent).detail?.action;
		if (!action) return;

		router.navigate(`/settings/${action}`);
		setSidebarExpanded(false);
	}, []);

	const handleExpandToggle = useCallback((e: Event) => {
		setSidebarExpanded(!!(e as CustomEvent).detail);
	}, []);

	// listeners
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

	return (
		<adc-layout>
			{!sessionChecked ? (
				<div className="max-w-3xl mx-auto px-4 py-8">
					<adc-skeleton variant="rectangular" height="48px" class="mb-6" />
					<adc-skeleton variant="rectangular" height="400px" />
				</div>
			) : !authenticated ? (
				<div className="max-w-3xl mx-auto px-4 py-16 text-center">
					<h1 className="font-heading text-2xl font-bold text-text mb-4">Acceso requerido</h1>
					<p className="text-muted">Debes iniciar sesión para ver tu cuenta.</p>
				</div>
			) : (
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
					items={Object.entries(SECTIONS).map(([key, value]) => ({
						label: value.label,
						iconSvg: value.icon,
						action: key,
					}))}
					collapsed={!sidebarExpanded}
					activeItem={activeSection}
					title="Mi cuenta"
					subtitle="Gestiona tu configuración"
				/>

				{/* Main */}
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
			)}
		</adc-layout>
	);
}
