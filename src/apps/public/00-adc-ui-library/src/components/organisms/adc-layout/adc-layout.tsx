import { Component, Prop } from "@stencil/core";
import { IS_DEV } from "../../../utils/url.js";
const host = () => globalThis.location?.hostname ?? "localhost";
const proto = () => globalThis.location?.protocol ?? "http:";
const port = () => (globalThis.location?.port ? `:${globalThis.location?.port}` : "");

/** Auth dev port / prod hostname */
const AUTH_PORT = 3012;
const AUTH_HOST = "auth.adigitalcafe.com";
/** API dev port */
const API_PORT = 3000;

function resolveAuthUrl(): string {
	return IS_DEV ? `http://${host()}:${AUTH_PORT}` : `${proto()}//${AUTH_HOST}${port()}`;
}

function resolveApiBaseUrl(): string {
	return IS_DEV ? `http://${host()}:${API_PORT}` : "";
}

@Component({
	tag: "adc-layout",
	shadow: false,
})
export class AdcLayout {
	// ── Header props (pass-through to adc-site-header) ──

	@Prop() logoSrc: string = "/ui/images/mini-logo.webp";
	@Prop() logoAlt: string = "ADC";
	@Prop() homeHref: string = "/";
	@Prop() fullWidth: boolean = false;
	@Prop() showAccessButton: boolean = true;
	@Prop() authUrl?: string;
	@Prop() apiBaseUrl?: string;

	// ── Footer props (pass-through to adc-site-footer) ──

	@Prop() brandName: string = "Abby's Digital Cafe";
	@Prop() brandSlogan: string = "Una taza de código con tintes de amistad";

	render() {
		const authUrl = this.authUrl || resolveAuthUrl();
		const apiBaseUrl = this.apiBaseUrl ?? resolveApiBaseUrl();

		return (
			<div class="flex flex-col min-h-screen bg-background text-text" style={{ paddingBottom: "var(--consent-h, 0px)" }}>
				<adc-custom-error variant="toast" global handle-unhandled />
				<adc-toast-manager />

				<adc-site-header
					logo-src={this.logoSrc}
					logo-alt={this.logoAlt}
					home-href={this.homeHref}
					show-access-button={this.showAccessButton}
					auth-url={authUrl}
					api-base-url={apiBaseUrl}
				>
					<slot name="header" />
				</adc-site-header>

				<main class={`flex-1 justify-center ${this.fullWidth ? "w-full" : "w-max min-w-7xl mx-auto"}`}>
					<slot />
				</main>

				<adc-site-footer class="z-40 mt-12" brand-name={this.brandName} brand-slogan={this.brandSlogan}>
					<slot name="footer" />
				</adc-site-footer>
			</div>
		);
	}
}
