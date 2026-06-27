import { Component, Prop, Element, Host } from "@stencil/core";
import type { AccessMenuItem } from "../../molecules/adc-access-button/adc-access-button.js";
import { isPrivateHost } from "../../../utils/url.js";
const port = () => (globalThis.location?.port ? `:${globalThis.location?.port}` : "");
@Component({
	tag: "adc-site-header",
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

	render() {
		return (
			<Host>
				<header class="flex items-center justify-between gap-3 px-4 py-4 md:gap-6 md:px-8 md:py-6 shadow-cozy bg-header text-theader font-bold rounded-b-xxl z-50">
					<a href={this.homeHref} aria-label="Inicio" class="ml-2">
						{this.logoSrc && (
							<img src={this.logoSrc} alt={this.logoAlt} height="39" width="39" style={{ minWidth: "39px" }} class="rounded-full" />
						)}
					</a>

					<nav class="flex flex-wrap items-center justify-end gap-2 md:gap-4" style={{ minHeight: "48px" }} aria-label="Menu">
						<slot></slot>

						<adc-apps-menu></adc-apps-menu>

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
				<adc-banner-host api-base-url={this.apiBaseUrl}></adc-banner-host>
			</Host>
		);
	}
}
