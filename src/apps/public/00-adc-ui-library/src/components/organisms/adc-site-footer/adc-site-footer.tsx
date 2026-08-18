import { Component, Prop, State } from "@stencil/core";
import { IS_DEV } from "@common/utils/url-utils.js";
import { publicEnv } from "@common/utils/public-env.js";

type FooterLinkKey = "privacy" | "terms" | "cookies" | "licenses" | "contact" | "team" | "help" | "status";

interface ADCGlobal {
	t?: (key: string, params?: Record<string, string> | null, namespace?: string) => string;
	loadTranslations?: (namespaces: string[], locale?: string) => Promise<void>;
	getLocale?: () => string;
}

const HELP_DEV_PORT = 3022;
const HELP_HOST = "help.adigitalcafe.com";
const STATUS_DEV_PORT = 3020;
const STATUS_HOST = "status.adigitalcafe.com";
const I18N_NAMESPACE = "adc-ui-library";

type FooterHost = "help" | "status";

const FOOTER_LINKS: ReadonlyArray<{ key: FooterLinkKey; path: string; target: FooterHost }> = [
	{ key: "privacy", path: "/privacy", target: "help" },
	{ key: "terms", path: "/terms", target: "help" },
	{ key: "cookies", path: "/cookies", target: "help" },
	// Aviso de licencias del código de terceros que va en el bundle. Va en el pie de
	// TODAS las apps porque todas sirven ese código; el listado lo genera el build.
	{ key: "licenses", path: "/licenses", target: "help" },
	{ key: "contact", path: "/contact", target: "help" },
	{ key: "team", path: "/team", target: "help" },
	{ key: "help", path: "/", target: "help" },
	{ key: "status", path: "/", target: "status" },
];

const FALLBACK_LABELS: Record<"es" | "en", Record<FooterLinkKey | "aria", string>> = {
	es: {
		aria: "Enlaces de ayuda",
		privacy: "Privacidad",
		terms: "Términos",
		cookies: "Cookies",
		licenses: "Licencias",
		contact: "Contacto",
		team: "Equipo",
		help: "Ayuda",
		status: "Estado",
	},
	en: {
		aria: "Help links",
		privacy: "Privacy",
		terms: "Terms",
		cookies: "Cookies",
		licenses: "Licenses",
		contact: "Contact",
		team: "Team",
		help: "Help",
		status: "Status",
	},
};

const host = () => globalThis.location?.hostname ?? "localhost";
const proto = () => globalThis.location?.protocol ?? "http:";
const adcI18n = globalThis as typeof globalThis & ADCGlobal;

function footerUrl(path: string, target: FooterHost): string {
	const devPort = target === "status" ? STATUS_DEV_PORT : HELP_DEV_PORT;
	const prodHost = target === "status" ? STATUS_HOST : HELP_HOST;
	return IS_DEV ? `${proto()}//${host()}:${devPort}${path}` : `${proto()}//${prodHost}${path}`;
}

/**
 * Identificador del Formulario 960/D, el `qr=` del enlace que genera ARCA en
 * «Data Fiscal → Banner en sitio web» (`ADC_PUBLIC_DATA_FISCAL_QR`).
 *
 * Sin configurar, el logo no se renderiza: resuelve a un CUIT y un nombre concretos, así que un
 * despliegue que no puso el suyo no puede mostrar el de otra persona.
 */
const DATA_FISCAL_QR = publicEnv("dataFiscalQr");

/** País del visitante según Cloudflare, inyectado por el provider HTTP. `null` si no se sabe. */
function visitorCountry(): string | null {
	return (globalThis as typeof globalThis & { __ADC_COUNTRY__?: string }).__ADC_COUNTRY__ ?? null;
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

	/**
	 * Formulario 960/D. La RG (AFIP) 4042-E lo exige en la página principal de quien vende online
	 * y a la vista en el punto de pago; como el footer va en todas, alcanza con ponerlo acá.
	 *
	 * Se oculta sólo cuando consta que el visitante NO está en Argentina: el logo no le dice nada
	 * a quien mira desde afuera. Si el país no se pudo determinar se muestra igual — no verlo en
	 * Argentina es un incumplimiento, y verlo de más es apenas ruido visual.
	 *
	 * El logo se sirve desde `common/public` y no desde afip.gob.ar a propósito: enlazar la imagen
	 * remota haría que el navegador de cada visitante contacte a un tercero en cada página, que es
	 * justo lo que la política de cookies dice que no pasa. El enlace sí es a ARCA, pero sólo se
	 * sigue si alguien lo aprieta.
	 *
	 * Va fuera del flujo (`absolute`) para no correr ni un píxel el contenido centrado del footer.
	 *
	 * **El `http://` del enlace no es un descuido: `qr.afip.gob.ar` no atiende en 443.** Es el
	 * enlace que ARCA entrega y redirige solo a `https://servicioscf.afip.gob.ar`. Pasarlo a
	 * `https` lo deja muerto por timeout, y el salto en claro no expone nada: el token de la URL
	 * publica exactamente los datos que este logo existe para publicar.
	 */
	private dataFiscalComponent() {
		const country = visitorCountry();
		if (!DATA_FISCAL_QR || (country && country !== "AR")) return null;
		return (
			<a
				href={`http://qr.afip.gob.ar/?qr=${DATA_FISCAL_QR}`}
				target="_F960AFIPInfo"
				rel="noopener noreferrer"
				class="absolute right-4 top-1/2 -translate-y-1/2"
			>
				<img src="/data-fiscal.jpg" alt="Formulario 960/D — Data Fiscal (ARCA)" width="36" height="49" loading="lazy" />
			</a>
		);
	}

	private helpLinksComponent() {
		return (
			<nav class="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1 text-sm max-w-70vw m-auto" aria-label={this.translateFooter("aria")}>
				{FOOTER_LINKS.map((link) => (
					<a key={link.key} href={footerUrl(link.path, link.target)} class="underline hover:no-underline">
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
				{this.registered ? "®" : "℠"} - {this.brandSlogan}
			</adc-text>
		);
	}

	render() {
		if (this.lowerSign) {
			return (
				<footer class="relative py-4 text-center opacity-80 border-t border-gray-200 shrink-0 min-h-24 cv-auto">
					<slot></slot>
					{this.helpLinksComponent()}
					{this.signComponent()}
					{this.dataFiscalComponent()}
				</footer>
			);
		}
		return (
			<footer class="relative py-4 text-center opacity-80 border-t border-gray-200 shrink-0 min-h-24 cv-auto">
				{this.signComponent()}
				{this.helpLinksComponent()}
				<slot></slot>
				{this.dataFiscalComponent()}
			</footer>
		);
	}
}
