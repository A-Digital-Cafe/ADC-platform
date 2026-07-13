import { Component, Prop, State, Element, Host, Listen } from "@stencil/core";

import { getUnavailableApps } from "@common/utils/module-availability.js";
import { getSession, type SessionUser } from "../../../../utils/session.js";
import { DEFAULT_APPS } from "./apps-config.js";
export interface AppMenuItem {
	id: string;
	name: string;
	url: string;
	icon?: string;
	/** Si se define, solo se muestra cuando el predicado retorna true con el usuario actual. */
	requires?: (user: SessionUser | undefined) => boolean;
	/**
	 * Nombre base del app en el kernel (ej: `adc-drive`). Si se define, el botón se
	 * oculta cuando la app está caída o deshabilitada vía modules-manager; sin él,
	 * el item se muestra siempre.
	 */
	moduleName?: string;
}

/** Icon tag name from app id: "community" → "adc-icon-app-community" */
function iconTag(id: string): string {
	return `adc-icon-app-${id}`;
}

@Component({
	tag: "adc-apps-menu",
	styleUrl: "adc-apps-menu.css",
	shadow: true,
})
export class AdcAppsMenu {
	@Element() el!: HTMLElement;

	/** Override default apps list (JSON array of AppMenuItem) */
	@Prop() apps?: string;

	@State() open = false;
	@State() sessionUser: SessionUser | undefined = undefined;

	/** Apps caídas/deshabilitadas (nombres base): sus botones no se muestran. */
	#unavailable: ReadonlySet<string> = new Set();

	async componentWillLoad() {
		// En paralelo: la sesión (predicados `requires`) y el estado de plataforma
		// (`__ADC_PLATFORM__`: 0 fetch en prod, 1 fetch cacheado en dev). Ambos degradan.
		const [session, unavailable] = await Promise.all([
			getSession(false, true).catch(() => null),
			getUnavailableApps().catch(() => new Set<string>()),
		]);
		this.sessionUser = session?.authenticated ? session.user : undefined;
		this.#unavailable = unavailable;
	}

	private get appList(): AppMenuItem[] {
		let list: AppMenuItem[] = DEFAULT_APPS;
		if (this.apps) {
			try {
				list = JSON.parse(this.apps);
			} catch {
				list = DEFAULT_APPS;
			}
		}
		return list
			.filter((app) => !app.moduleName || !this.#unavailable.has(app.moduleName))
			.filter((app) => (app.requires ? app.requires(this.sessionUser) : true));
	}

	@Listen("mousedown", { target: "document" })
	handleOutsideClick(e: MouseEvent) {
		if (this.open && !this.el.contains(e.target as Node)) {
			this.open = false;
		}
	}

	private readonly toggle = () => {
		this.open = !this.open;
	};

	private readonly isCurrent = (url: string): boolean => {
		const origin = globalThis.location?.origin;
		return origin === url || origin + "/" === url + "/";
	};

	render() {
		const apps = this.appList;

		return (
			<Host>
				<button class="apps-trigger" onClick={this.toggle} aria-label="Apps" aria-expanded={String(this.open)} title="Apps">
					<adc-icon-apps></adc-icon-apps>
				</button>

				{this.open && (
					<div class="apps-dropdown">
						{apps.map((app) => {
							const IconTag = iconTag(app.id);
							return (
								<a key={app.id} href={app.url} class="app-link" {...(this.isCurrent(app.url) ? { "data-active": "" } : {})}>
									<IconTag size="1.75rem"></IconTag>
									<span class="app-label">{app.name}</span>
								</a>
							);
						})}
					</div>
				)}
			</Host>
		);
	}
}
