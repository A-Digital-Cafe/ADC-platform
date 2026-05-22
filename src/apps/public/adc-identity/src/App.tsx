import "@ui-library/utils/react-jsx";
import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "@ui-library/utils/i18n-react";
import { router } from "@common/utils/router";
import { identityApi } from "./utils/identity-api.ts";
import type { Permission } from "@common/types/identity/Permission.ts";
import type { Organization } from "@common/types/identity/Organization.ts";
import { getVisibleTabs, type IdentityTab } from "./utils/permissions.ts";
import { LandingView } from "./pages/LandingView.tsx";
import { UsersView } from "./pages/UsersView.tsx";
import { RolesView } from "./pages/RolesView.tsx";
import { GroupsView } from "./pages/GroupsView.tsx";
import { OrganizationsView } from "./pages/OrganizationsView.tsx";
import { RegionsView } from "./pages/RegionsView.tsx";
import { clearErrors } from "@ui-library/utils/adc-fetch";
import { getSession } from "@ui-library/utils/session";

/** Extracts tab id from a URL path like "/roles" → "roles", "/" → "" */
function getTabFromPath(path: string): string {
	return path.replace(/^\/+/, "").split("/")[0] || "";
}

export default function App() {
	const { t, ready } = useTranslation({ namespace: "adc-identity", autoLoad: true });
	const [perms, setPerms] = useState<Permission[]>([]);
	const [visibleTabs, setVisibleTabs] = useState<IdentityTab[]>([]);
	const [activeTab, setActiveTab] = useState<string>("");
	const [loading, setLoading] = useState(true);
	const [unauthorized, setUnauthorized] = useState(false);

	// Contexto de organización
	const [tokenOrgId, setTokenOrgId] = useState<string | undefined>(undefined);
	const [isAdmin, setIsAdmin] = useState(false);

	// Filtro de org para admin global
	const [organizations, setOrganizations] = useState<Organization[]>([]);
	const [selectedOrgFilter, setSelectedOrgFilter] = useState<string | undefined>(undefined);

	// orgId efectivo: viene del token (org admin) o del filtro (global admin)
	const effectiveOrgId = selectedOrgFilter || tokenOrgId;
	const isScopedOrgView = Boolean(effectiveOrgId);

	const loadPermissions = useCallback(async () => {
		setLoading(true);
		clearErrors();

		const session = await getSession(true);

		if (session.authenticated && session.user) {
			const userPerms = session.user.perms ?? [];
			setPerms(userPerms);
			const currentOrgId = session.user.orgId || undefined;
			setTokenOrgId(currentOrgId);
			setIsAdmin(session.user.isAdmin ?? false);

			const tabs = getVisibleTabs(userPerms, currentOrgId);
			setVisibleTabs(tabs);

			if (tabs.length > 0) {
				// Resolve initial tab from URL path, fallback to first tab (allow-list inline).
				const pathTab = getTabFromPath(router.getCurrentPath());
				const initialTab = tabs.some((tab) => tab.id === pathTab) ? pathTab : tabs[0].id;
				setActiveTab(initialTab);

				if (initialTab !== pathTab) {
					router.navigate("/" + initialTab);
				}
			} else {
				setUnauthorized(true);
			}
		} else {
			setUnauthorized(true);
		}

		setLoading(false);
	}, []);

	useEffect(() => {
		loadPermissions();
	}, [loadPermissions]);

	// Cargar lista de organizaciones para el filtro (solo admin global)
	useEffect(() => {
		if (isAdmin && !tokenOrgId) {
			identityApi.listOrganizations().then((res) => {
				if (res.success && res.data) setOrganizations(res.data);
			});
		}
	}, [isAdmin, tokenOrgId]);

	const handleTabChange = useCallback(
		(tabId: string) => {
			// Allow-list inline: solo navegamos si el tab está en `visibleTabs`.
			if (!visibleTabs.some((tab) => tab.id === tabId)) return;
			setActiveTab(tabId);
			clearErrors();
			router.navigate("/" + tabId);
		},
		[visibleTabs]
	);

	const handleOrgFilterChange = useCallback((value: string) => {
		setSelectedOrgFilter(value || undefined);
		clearErrors();
	}, []);

	const comboboxRef = useCallback(
		(el: HTMLElement | null) => {
			if (el) el.addEventListener("adcChange", (e: Event) => handleOrgFilterChange((e as CustomEvent<string>).detail));
		},
		[handleOrgFilterChange]
	);

	// Sync tabs with browser back/forward navigation
	useEffect(() => {
		return router.setOnRouteChange((path) => {
			const tabId = getTabFromPath(path);
			if (tabId && visibleTabs.some((tab) => tab.id === tabId)) {
				setActiveTab(tabId);
				clearErrors();
			}
		});
	}, [visibleTabs]);

	const tabsRef = useRef<HTMLElement>(null);

	useEffect(() => {
		const el = tabsRef.current;
		if (!el) return;
		const handler = (e: Event) => handleTabChange((e as CustomEvent<string>).detail);
		el.addEventListener("adcTabChange", handler);
		return () => el.removeEventListener("adcTabChange", handler);
	});

	// Loading skeleton
	if (!ready || loading) {
		return (
			<adc-layout>
				<div className="max-w-6xl mx-auto px-4 py-8">
					<adc-skeleton variant="rectangular" height="48px" class="mb-6" />
					<adc-skeleton variant="rectangular" height="400px" />
				</div>
			</adc-layout>
		);
	}

	// Unauthorized or no visible tabs - show landing view
	if (unauthorized || visibleTabs.length === 0) {
		return (
			<adc-layout>
				<LandingView />
			</adc-layout>
		);
	}

	const tabItems = visibleTabs.map((tab) => ({
		id: tab.id,
		label: t(`tabs.${tab.label}`),
	}));

	const renderActiveView = () => {
		switch (activeTab) {
			case "users":
				return (
					<UsersView
						perms={perms}
						orgId={effectiveOrgId}
						isAdmin={isAdmin}
						isScopedOrgView={isScopedOrgView}
						organizations={organizations}
					/>
				);
			case "roles":
				return <RolesView perms={perms} orgId={effectiveOrgId} organizations={organizations} />;
			case "groups":
				return <GroupsView perms={perms} orgId={effectiveOrgId} organizations={organizations} />;
			case "organizations":
				return <OrganizationsView perms={perms} />;
			case "regions":
				return <RegionsView perms={perms} />;
			default:
				return null;
		}
	};

	return (
		<adc-layout>
			<div className="max-w-6xl mx-auto px-4 py-8">
				<h1 className="font-heading text-2xl font-bold text-text mb-6">{t("common.title")}</h1>

				{/* Filtro de organización para admin global */}
				{isAdmin && !tokenOrgId && organizations.length > 0 && (
					<div className="mb-4 flex items-center gap-3">
						<label className="text-sm font-medium text-text whitespace-nowrap">{t("common.orgFilter")}:</label>
						<adc-combobox
							ref={comboboxRef}
							value={selectedOrgFilter || ""}
							placeholder={t("common.globalView")}
							options={JSON.stringify(organizations.map((org) => ({ label: org.slug, value: org.orgId })))}
							class="min-w-50"
						/>
						{selectedOrgFilter && (
							<adc-badge color="indigo" size="sm">
								{organizations.find((o) => o.orgId === selectedOrgFilter)?.slug}
							</adc-badge>
						)}
					</div>
				)}

				<adc-tabs ref={tabsRef} tabs={JSON.stringify(tabItems)} activeTab={activeTab} variant="underline" />

				<div className="mt-6">{renderActiveView()}</div>
			</div>
		</adc-layout>
	);
}
