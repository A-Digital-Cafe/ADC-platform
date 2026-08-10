import { createElement, Fragment, useEffect, useState, type ComponentType } from "react";
import { getPlatformAppOrigin, type PlatformApp } from "@ui-library/utils/platform-links";
import { lazyLoadRemoteComponent } from "@adc/utils/react/loadRemoteComponent";

/**
 * Tab aportada por otra app vía Module Federation (`adminPanelExpose`). Mismo patrón que los
 * paneles de cuenta de `my-account`: el panel vive en la app dueña de su API —así el panel de
 * moderación de Drive sigue en el preset de Drive y no se duplica acá—, y si esa app está
 * offline la tab queda vacía en vez de romper el host.
 */
const cache = new Map<string, Promise<ComponentType | null>>();

function loadPanel(app: PlatformApp): Promise<ComponentType | null> {
	let promise = cache.get(app.id);
	if (!promise) {
		promise = (async () => {
			const { Component } = await lazyLoadRemoteComponent({
				remoteEntryUrl: `${getPlatformAppOrigin(app)}/remoteEntry.js`,
				remoteName: app.remoteName!,
				scope: app.adminPanelExpose!,
				moduleName: `${app.id}-admin-panel`,
				framework: "react",
				errorComponent: () => createElement(Fragment),
			});
			return Component;
		})();
		cache.set(app.id, promise);
	}
	return promise;
}

export function FederatedAdminTab({ app }: Readonly<{ app: PlatformApp }>) {
	const [Panel, setPanel] = useState<ComponentType | null>(null);
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		let alive = true;
		loadPanel(app).then((Component) => {
			if (!alive) return;
			if (Component) setPanel(() => Component);
			else setFailed(true);
		});
		return () => {
			alive = false;
		};
	}, [app]);

	if (failed) {
		return (
			<adc-callout tone="warning" role="note">
				El panel de {app.label} no está disponible: la app puede estar detenida.
			</adc-callout>
		);
	}
	if (!Panel) return <p className="text-sm text-muted">Cargando panel de {app.label}…</p>;
	return <Panel />;
}
