import "@ui-library/utils/react-jsx";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { getSession } from "@ui-library/utils/session";
import { getAdminPanelApps } from "@ui-library/utils/platform-links";
import { hasPermission } from "@common/utils/perms.ts";
import { CRUDXAction } from "@common/types/Actions.ts";
import { SecurityScopes, SECURITY_RESOURCE_NAME } from "@common/types/security/permissions.ts";
import { PlanScopes, PLANS_RESOURCE_NAME } from "@common/types/plans/permissions.ts";
import type { Permission } from "@common/types/identity/Permission.ts";
import { AdcTabs, type AdcTab } from "./components/AdcTabs.tsx";
import { FederatedAdminTab } from "./components/FederatedAdminTab.tsx";
import BreachPanel from "./components/breach/BreachPanel.tsx";
import AuditPanel from "./components/AuditPanel.tsx";
import PlansPanel from "./components/plans/PlansPanel.tsx";

/** Bit `moderate` del recurso `drive` (ver DRIVE_SCOPES en @common/types/resources.ts). */
const DRIVE_MODERATE = 1 << 1;

/**
 * Capacidades del caller. Igual que en el gestor de módulos, son sólo para decidir qué se pinta:
 * cada endpoint vuelve a chequear el permiso, y los recursos `security`/`plans` son global-only,
 * así que en contexto de organización no hay nada que administrar.
 */
interface Caps {
	breachRead: boolean;
	breachWrite: boolean;
	/** Máquina de estados del registro (avanzar, congelar audiencia, despachar el aviso). */
	breachExecute: boolean;
	audit: boolean;
	plansCatalog: boolean;
	plansOverrides: boolean;
	driveModerate: boolean;
}

const NO_CAPS: Caps = {
	breachRead: false,
	breachWrite: false,
	breachExecute: false,
	audit: false,
	plansCatalog: false,
	plansOverrides: false,
	driveModerate: false,
};

function capsFrom(perms: Permission[], orgId?: string): Caps {
	if (orgId) return NO_CAPS;
	const can = (scope: number, action: number, resource: string = SECURITY_RESOURCE_NAME) => hasPermission(perms, resource, action, scope);
	return {
		breachRead: can(SecurityScopes.BREACH, CRUDXAction.READ),
		breachWrite: can(SecurityScopes.BREACH, CRUDXAction.WRITE),
		breachExecute: can(SecurityScopes.BREACH, CRUDXAction.EXECUTE),
		audit: can(SecurityScopes.AUDIT_LOG, CRUDXAction.READ),
		// Sólo lectura para decidir visibilidad: el panel muestra lo que puede leer y deja que el
		// backend rechace la escritura si el rol no tiene UPDATE.
		plansCatalog: can(PlanScopes.CATALOG, CRUDXAction.READ, PLANS_RESOURCE_NAME),
		plansOverrides: can(PlanScopes.OVERRIDES, CRUDXAction.READ, PLANS_RESOURCE_NAME),
		driveModerate: hasPermission(perms, "drive", CRUDXAction.EXECUTE, DRIVE_MODERATE),
	};
}

export default function App() {
	const [caps, setCaps] = useState<Caps | null>(null);
	const [tab, setTab] = useState<string>("breaches");
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);

	const refresh = useCallback(async () => {
		setLoading(true);
		try {
			const session = await getSession(true);
			const next = session.authenticated && session.user ? capsFrom(session.user.perms ?? [], session.user.orgId) : NO_CAPS;
			setCaps(next);
			// Alcanza con UNA capacidad: hay roles que sólo administran planes y otros sólo moderan.
			setError(Object.values(next).some(Boolean) ? null : "Necesitás permisos globales de administración de la plataforma.");
		} catch {
			setError("No se pudo verificar la sesión.");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	// Tabs federadas: sólo las de apps que declaran `adminPanelExpose` y cuyo permiso tiene el caller.
	const federated = useMemo(() => {
		if (!caps?.driveModerate) return [];
		return getAdminPanelApps().filter((a) => a.id === "drive");
	}, [caps]);

	const tabs = useMemo<AdcTab[]>(() => {
		if (!caps) return [];
		const list: AdcTab[] = [];
		if (caps.breachRead) list.push({ id: "breaches", label: "Brechas" });
		if (caps.audit) list.push({ id: "audit", label: "Auditoría" });
		if (caps.plansCatalog || caps.plansOverrides) list.push({ id: "plans", label: "Planes" });
		for (const app of federated) list.push({ id: app.id, label: app.adminPanelLabel ?? app.label });
		return list;
	}, [caps, federated]);

	// El tab por defecto sólo existe con permiso de brechas: un rol que sólo administra planes
	// entraría a un panel vacío y sin tab marcado.
	useEffect(() => {
		if (tabs.length > 0 && !tabs.some((t) => t.id === tab)) setTab(tabs[0].id);
	}, [tabs, tab]);

	const panels: Record<string, ReactNode> = {
		breaches: <BreachPanel canWrite={caps?.breachWrite ?? false} canExecute={caps?.breachExecute ?? false} />,
		audit: <AuditPanel />,
		plans: <PlansPanel canCatalog={caps?.plansCatalog ?? false} canOverrides={caps?.plansOverrides ?? false} />,
	};
	const federatedApp = federated.find((a) => a.id === tab);

	return (
		<adc-layout fullWidth>
			<adc-page-shell sidebarOffset={false}>
				<div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
					<header className="flex flex-wrap items-center justify-between gap-3">
						<div className="flex items-center gap-3">
							<span className="text-2xl" aria-hidden="true">
								🛡️
							</span>
							<div>
								<h1 className="font-heading text-2xl font-bold text-text">Administración</h1>
								<p className="text-sm text-muted">Incidentes de datos, auditoría, planes y moderación de contenido.</p>
							</div>
						</div>
						<adc-button variant="accent-outlined" size="small" label="Refrescar" onClick={() => void refresh()} />
					</header>

					{error && (
						<adc-callout tone="error" role="alert">
							{error}
						</adc-callout>
					)}

					{loading && !caps && <p className="text-sm text-muted">Cargando…</p>}

					{tabs.length > 0 && (
						<>
							<AdcTabs tabs={tabs} activeId={tab} onChange={setTab} />
							{federatedApp ? <FederatedAdminTab app={federatedApp} /> : panels[tab]}
						</>
					)}
				</div>
			</adc-page-shell>
		</adc-layout>
	);
}
