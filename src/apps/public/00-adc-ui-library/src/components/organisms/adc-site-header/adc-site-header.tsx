import { Component, Prop, Element, Host, Event, EventEmitter } from "@stencil/core";
import type { AccessMenuItem } from "../../molecules/adc-access-button/adc-access-button.js";
import { isPrivateHost } from "@common/utils/url-utils.js";
const port = () => (globalThis.location?.port ? `:${globalThis.location?.port}` : "");
@Component({
	tag: "adc-site-header",
	styleUrl: "adc-site-header.css",
	shadow: false,
})
export class AdcSiteHeader {
	@Element() el!: HTMLElement;

	@Prop() logoSrc: string = "";
	@Prop() logoAlt: string = "";
	@Prop() homeHref: string = "/";

	@Prop() authUrl: string = `${globalThis.location?.protocol}//auth.adigitalcafe.com${port()}`;

	@Prop() apiBaseUrl: string = isPrivateHost(globalThis.location?.hostname ?? "")
		? `${globalThis.location?.protocol}//${globalThis.location?.hostname}:3000`
		: "";

	@Prop() showAccessButton: boolean = true;
	@Prop() userMenuItems: AccessMenuItem[] = [];

	/**
	 * Apps con menú lateral propio (drive, correo): en mobile el logo pasa a ser el
	 * botón que abre ese menú. El objetivo táctil del header es mucho más cómodo que
	 * una flecha flotante sobre el contenido.
	 */
	@Prop() mobileMenu: boolean = false;
	/** Estado del menú de la app, para el `aria-expanded` y el icono. */
	@Prop() mobileMenuOpen: boolean = false;
	@Prop() mobileMenuLabel: string = "Menú";

	/** Emite el estado pedido (`true` = abrir). */
	@Event() adcMobileMenuToggle!: EventEmitter<boolean>;

	componentDidLoad() {
		this.updateVars();
		window.addEventListener("resize", this.updateVars);
		window.addEventListener("scroll", this.updateVars);
	}

	disconnectedCallback() {
		window.removeEventListener("resize", this.updateVars);
		window.removeEventListener("scroll", this.updateVars);
	}

	private readonly updateVars = () => {
		const rect = this.el.getBoundingClientRect();

		const height = rect.height;
		const offset = Math.max(rect.bottom, 0);

		document.documentElement.style.setProperty("--header-h", `${height}px`);
		document.documentElement.style.setProperty("--header-offset", `${offset}px`);
	};

	private readonly handleMobileMenuClick = () => {
		this.adcMobileMenuToggle.emit(!this.mobileMenuOpen);
	};

	private renderLogo() {
		if (!this.logoSrc) return null;
		return <img src={this.logoSrc} alt={this.logoAlt} height="39" width="39" style={{ minWidth: "39px" }} class="rounded-full" />;
	}

	/** Cara funcional del botón: hamburguesa, o cruz mientras el menú está abierto. */
	private renderMenuIcon() {
		const path = this.mobileMenuOpen ? "M6 6l12 12M18 6L6 18" : "M4 7h16M4 12h16M4 17h16";
		return (
			<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
				<path d={path} />
			</svg>
		);
	}

	private renderBrand() {
		const logoLink = (
			<a key="brand-logo" href={this.homeHref} aria-label="Inicio" class={this.mobileMenu ? "ml-2 adc-header-brand" : "ml-2"}>
				{this.renderLogo()}
			</a>
		);

		if (!this.mobileMenu) return logoLink;

		return [
			<button
				key="brand-menu"
				type="button"
				class="adc-header-menu ml-2"
				aria-label={this.mobileMenuLabel}
				aria-expanded={this.mobileMenuOpen ? "true" : "false"}
				onClick={this.handleMobileMenuClick}
			>
				<span class="adc-header-menu__flip" data-open={this.mobileMenuOpen ? "true" : "false"}>
					<span class="adc-header-menu__face">{this.renderMenuIcon()}</span>
					<span class="adc-header-menu__face adc-header-menu__face--logo" aria-hidden="true">
						{this.renderLogo()}
					</span>
				</span>
			</button>,
			logoLink,
		];
	}

	render() {
		return (
			<Host>
				<header class="flex items-center justify-between gap-3 px-4 py-4 md:gap-6 md:px-8 md:py-6 shadow-cozy bg-header text-theader font-bold rounded-b-xxl z-50">
					{this.renderBrand()}

					<nav class="flex flex-wrap items-center justify-end gap-2 md:gap-4" style={{ minHeight: "48px" }} aria-label="Menu">
						<slot></slot>

						<adc-apps-menu></adc-apps-menu>

						{/* Engranaje de la app que esté montada (Drive, Correo, …). Se pinta sólo si esa app
						    lo enciende; el modal con las pestañas lo pone ella. */}
						<adc-settings-menu></adc-settings-menu>

						{/* Campana de notificaciones: se auto-oculta si el backend (preset adc-notifications) no responde. */}
						<adc-notification-bell></adc-notification-bell>

						{this.showAccessButton && (
							<adc-access-button
								auth-url={this.authUrl}
								api-base-url={this.apiBaseUrl}
								menuItems={this.userMenuItems}
							></adc-access-button>
						)}
					</nav>
				</header>

				{/* Avisos de mantenimiento/anuncios, justo debajo del header (1 fetch/página, compartido). */}
				<adc-banner-host></adc-banner-host>

				{/* Re-aceptación de documentos legales: se pinta sola sólo si hay algo pendiente. */}
				<adc-legal-gate></adc-legal-gate>
			</Host>
		);
	}
}
