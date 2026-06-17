import "@ui-library/utils/react-jsx";
import { createElement, useState, useEffect, useRef } from "react";
import { Shell } from "./components/Shell.tsx";
import { router, type RouteDefinition } from "@common/utils/router.js";
import { lazyLoadRemoteComponent, type Framework } from "@adc/utils/react/loadRemoteComponent";
import { getRemoteEntryUrl } from "@common/utils/url-utils.js";
import { isAppUnavailable, maintenanceMessage } from "@common/utils/module-availability.js";

// Las funciones t(), setLocale(), getLocale() están disponibles globalmente
// desde adc-i18n.js (cargado en index.html)

interface RemoteModuleConfig {
	framework: Framework;
	remoteEntryUrl: string;
	remoteName: string;
	scope: string;
}

const moduleDefinitions: Record<string, RemoteModuleConfig> = {
	home: {
		framework: "vanilla",
		remoteEntryUrl: getRemoteEntryUrl(3002, "s-home.local.com"),
		remoteName: "home",
		scope: "./App",
	},
	"users-management": {
		framework: "react",
		remoteEntryUrl: getRemoteEntryUrl(3001, "s-users.local.com"),
		remoteName: "users_management",
		scope: "./App",
	},
	config: {
		framework: "vue",
		remoteEntryUrl: getRemoteEntryUrl(3003, "s-config.local.com"),
		remoteName: "config",
		scope: "./App",
	},
};

const routes: RouteDefinition[] = [
	{ module: "home", path: "/" },
	{ module: "users-management", path: "/users", subdomain: "users" },
	{ module: "config", path: "/config", subdomain: "config" },
];
const notFoundComponent = () => <div style={{ padding: 20, textAlign: "center", color: "#a0aec0" }}>Página no encontrada</div>;

const maintenanceComponent = (message: string) => () =>
	(
		<div style={{ padding: 40, textAlign: "center", maxWidth: 520, margin: "0 auto" }}>
			<div style={{ fontSize: 48 }} aria-hidden="true">
				🛠️
			</div>
			<h2 style={{ marginBottom: 8 }}>No disponible temporalmente</h2>
			<p style={{ color: "#a0aec0", lineHeight: 1.5 }}>{message}</p>
		</div>
	);

export default function App() {
	const [renderKey, setRenderKey] = useState(0);
	const [currentPath, setCurrentPath] = useState(globalThis.location?.pathname ?? "");
	const [moduleData, setModuleData] = useState<any>(null);
	const [loading, setLoading] = useState(true);
	const loadingPathRef = useRef<string | null>(null);
	const isInitialized = useRef(false);

	// Determina el path de navegación considerando subdominios
	const getNavPath = (): string => {
		const subdomain = router.getSubdomain();
		if (subdomain) {
			const subdomainRoute = routes.find((r) => r.subdomain === subdomain);
			if (subdomainRoute?.path) {
				return subdomainRoute.path;
			}
		}
		return globalThis.location?.pathname ?? "";
	};

	useEffect(() => {
		if (isInitialized.current) return;
		isInitialized.current = true;

		async function loadComponent(path: string) {
			if (loadingPathRef.current === path) return;

			const moduleName = router.resolveModule(routes);

			if (!moduleName || !moduleDefinitions[moduleName]) {
				console.warn("[Layout] Ruta no reconocida:", path);
				setModuleData({
					Component: notFoundComponent,
					moduleName: "not-found",
					timestamp: Date.now(),
				});
				setLoading(false);
				return;
			}

			loadingPathRef.current = path;
			setLoading(true);

			// Pequeño delay para dar feedback visual y permitir a React desmontar
			await new Promise((resolve) => setTimeout(resolve, 10));

			// Si la app está deshabilitada (modules-manager), mostrar mantenimiento.
			const availability = await isAppUnavailable(moduleName);
			if (availability) {
				setModuleData({
					Component: maintenanceComponent(maintenanceMessage(availability.messageKey)),
					moduleName: `${moduleName}-maintenance`,
					timestamp: Date.now(),
				});
				setCurrentPath(getNavPath());
				setRenderKey((prev) => prev + 1);
				setLoading(false);
				loadingPathRef.current = null;
				return;
			}

			const definition = moduleDefinitions[moduleName];
			const data = await lazyLoadRemoteComponent({
				remoteEntryUrl: definition.remoteEntryUrl,
				remoteName: definition.remoteName,
				scope: definition.scope,
				moduleName,
				framework: definition.framework,
			});

			console.log(`[Layout] ✅ ${data.moduleName} @ ${path}`);

			setCurrentPath(getNavPath());
			setModuleData(data);
			setRenderKey((prev) => prev + 1);
			setLoading(false);
			loadingPathRef.current = null;
		}

		loadComponent(globalThis.location?.pathname ?? "");
		router.setOnRouteChange((path: string) => {
			console.log("[Layout] 🔄 Route change:", path);
			loadComponent(path);
		});
	}, []);

	if (!moduleData || loading) {
		return (
			<Shell currentPath={currentPath}>
				<div style={{ padding: "20px", textAlign: "center" }}>
					<p>Cargando...</p>
				</div>
			</Shell>
		);
	}

	return (
		<Shell key={renderKey} currentPath={currentPath}>
			{createElement(moduleData.Component)}
		</Shell>
	);
}
