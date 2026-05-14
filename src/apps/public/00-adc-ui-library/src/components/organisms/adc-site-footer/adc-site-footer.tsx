import { Component, Prop, State } from "@stencil/core";
import { IS_DEV } from "../../../utils/url.js";

type FooterLinkKey = "privacy" | "terms" | "cookies" | "contact" | "help";

interface ADCGlobal {
	t?: (key: string, params?: Record<string, string> | null, namespace?: string) => string;
	loadTranslations?: (namespaces: string[], locale?: string) => Promise<void>;
	getLocale?: () => string;
}

const HELP_DEV_PORT = 3022;
const HELP_HOST = "help.adigitalcafe.com";
const I18N_NAMESPACE = "adc-ui-library";

const HELP_LINKS: ReadonlyArray<{ key: FooterLinkKey; path: string }> = [
	{ key: "privacy", path: "/privacy" },
	{ key: "terms", path: "/terms" },
	{ key: "cookies", path: "/cookies" },
	{ key: "contact", path: "/contact" },
	{ key: "help", path: "/" },
];

const FALLBACK_LABELS: Record<"es" | "en", Record<FooterLinkKey | "aria", string>> = {
	es: {
		aria: "Enlaces de ayuda",
		privacy: "Privacidad",
		terms: "Términos",
		cookies: "Cookies",
		contact: "Contacto",
		help: "Ayuda",
	},
	en: {
		aria: "Help links",
		privacy: "Privacy",
		terms: "Terms",
		cookies: "Cookies",
		contact: "Contact",
		help: "Help",
	},
};

const host = () => globalThis.location?.hostname ?? "localhost";
const proto = () => globalThis.location?.protocol ?? "http:";
const adcI18n = globalThis as typeof globalThis & ADCGlobal;

function helpUrl(path: string): string {
	return IS_DEV ? `${proto()}//${host()}:${HELP_DEV_PORT}${path}` : `${proto()}//${HELP_HOST}${path}`;
}

function fallbackLocale(): "es" | "en" {
	const language = (adcI18n.getLocale?.() || globalThis.document?.documentElement?.lang || globalThis.navigator?.language || "").toLowerCase();
	return language.startsWith("en") ? "en" : "es";
}

@Component({
	tag: "adc-site-footer",
	shadow: false,
})
export class AdcSiteFooter {
	@Prop() brandName: string = "";
	@Prop() brandSlogan: string = "";
	@Prop() creatorName: string = "";
	@Prop() creatorHref: string = "";
	@Prop() lowerSign: boolean = false;
	@Prop() registered: boolean = false;
	@State() private i18nVersion = 0;

	connectedCallback() {
		globalThis.addEventListener("adc:i18n:loaded", this.handleI18nLoaded);
		void this.loadFooterTranslations();
	}

	disconnectedCallback() {
		globalThis.removeEventListener("adc:i18n:loaded", this.handleI18nLoaded);
	}

	private getYear(): number {
		return new Date().getFullYear();
	}

	private readonly handleI18nLoaded = () => {
		this.i18nVersion += 1;
	};

	private async loadFooterTranslations() {
		if (!adcI18n.loadTranslations) return;

		try {
			await adcI18n.loadTranslations([I18N_NAMESPACE]);
		} catch {
			// Keep fallback labels if the i18n client is not ready.
		}
	}

	private translateFooter(key: FooterLinkKey | "aria"): string {
		const translationKey = `footer.${key}`;
		const translated = adcI18n.t?.(translationKey, null, I18N_NAMESPACE);

		if (translated && translated !== translationKey) return translated;
		return FALLBACK_LABELS[fallbackLocale()][key];
	}

	private helpLinksComponent() {
		return (
			<nav class="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1 text-sm" aria-label={this.translateFooter("aria")}>
				{HELP_LINKS.map((link) => (
					<a key={link.key} href={helpUrl(link.path)} class="underline hover:no-underline">
						{this.translateFooter(link.key)}
					</a>
				))}
			</nav>
		);
	}

	signComponent() {
		return (
			<adc-text>
				&copy; 2025-{this.getYear()} {this.brandName}
				{this.registered ? "®" : "℠"} - {this.brandSlogan} · creada por{" "}
				<a
					href={this.creatorHref}
					target="_blank"
					rel="noopener noreferrer"
					aria-label={`Sitio de ${this.creatorName} (se abre en una pestaña nueva)`}
				>
					{this.creatorName}
					<span class="sr-only"> (se abre en una pestaña nueva)</span>
				</a>
			</adc-text>
		);
	}

	render() {
		if (this.lowerSign) {
			return (
				<footer class="py-4 text-center opacity-80 border-t border-gray-200 shrink-0 min-h-24 cv-auto">
					<slot></slot>
					{this.helpLinksComponent()}
					{this.signComponent()}
				</footer>
			);
		}
		return (
			<footer class="py-4 text-center opacity-80 border-t border-gray-200 shrink-0 min-h-24 cv-auto">
				{this.signComponent()}
				{this.helpLinksComponent()}
				<slot></slot>
			</footer>
		);
	}
}
