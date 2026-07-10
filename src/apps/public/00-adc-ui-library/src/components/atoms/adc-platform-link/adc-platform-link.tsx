import { Component, Prop, State, Watch, Element } from "@stencil/core";

import { resolvePlatformLinkInfo, type PlatformLinkInfo } from "../../../../utils/platform-links.js";

interface ADCGlobal {
	t?: (key: string, params?: Record<string, string> | null, namespace?: string) => string;
	getLocale?: () => string;
	loadTranslations?: (namespaces: string[], locale?: string) => Promise<void>;
}

const I18N_NAMESPACE = "adc-ui-library";
const adcI18n = globalThis as typeof globalThis & ADCGlobal;

/** Fallbacks por idioma cuando el cliente i18n aún no cargó (solo apps con nombre traducible). */
const FALLBACK_APP_LABELS: Record<"es" | "en", Record<string, string>> = {
	es: { community: "Comunidad", projects: "Proyectos", identity: "Identidad", editor: "Editor de imágenes", org: "Organizaciones", status: "Estado", "my-account": "Mi cuenta" },
	en: {},
};
const FALLBACK_DENIED: Record<"es" | "en", string> = { es: "Sin acceso", en: "No access" };

function fallbackLocale(): "es" | "en" {
	const language = (adcI18n.getLocale?.() || globalThis.document?.documentElement?.lang || globalThis.navigator?.language || "").toLowerCase();
	return language.startsWith("en") ? "en" : "es";
}

/** Traduce con fallback: devuelve el valor i18n si existe, si no el provisto. */
function translate(key: string, fallback: string): string {
	const translated = adcI18n.t?.(key, null, I18N_NAMESPACE);
	if (translated && translated !== key) return translated;
	return fallback;
}

/**
 * Chip de enlace de plataforma estilo Jira / Google Docs.
 *
 * Recibe un `href` que apunta a un microfront de la plataforma y, cargando bajo
 * demanda el resolver federado que esa app expone en su `config.json`
 * (`federationExposes`), muestra el icono de la app, su nombre y el título de la
 * entidad destino (artículo, tarea, tablero…). Estados: cargando, ok, sin
 * acceso (`denied`) y fallback.
 *
 * El texto se puede fijar con el prop `label` o como children (slot); cuando se
 * provee, tiene prioridad sobre el título resuelto/humanizado. El nombre de la
 * app (`appLabel`) y los textos de estado se localizan vía i18n (es/en).
 *
 * Si la URL no resuelve a ningún microfront conocido, se degrada a un enlace
 * normal con el texto provisto.
 */
@Component({
	tag: "adc-platform-link",
	shadow: false,
})
export class AdcPlatformLink {
	/** URL destino (absoluta o relativa). */
	@Prop() href!: string;
	/** Texto del enlace; si se omite se usan los children. Tiene prioridad sobre el título resuelto. */
	@Prop() label?: string;

	@Element() hostEl!: HTMLElement;

	@State() info: PlatformLinkInfo | null = null;
	@State() loading = true;
	/** Bump para re-render cuando el cliente i18n carga traducciones. */
	@State() i18nVersion = 0;
	/** Texto autor-provisto (prop `label` o children), capturado antes del primer render. */
	@State() authorLabel = "";

	@Watch("href")
	onHrefChange() {
		this.resolve();
	}

	componentWillLoad() {
		// Capturar el texto autor-provisto antes de que el render reemplace los children.
		this.authorLabel = (this.label || this.hostEl.textContent || "").trim();
		globalThis.addEventListener("adc:i18n:loaded", this.handleI18nLoaded);
		void adcI18n.loadTranslations?.([I18N_NAMESPACE]).catch(() => undefined);
		return this.resolve();
	}

	disconnectedCallback() {
		globalThis.removeEventListener("adc:i18n:loaded", this.handleI18nLoaded);
	}

	private readonly handleI18nLoaded = () => {
		this.i18nVersion += 1;
	};

	private async resolve() {
		this.loading = true;
		try {
			this.info = await resolvePlatformLinkInfo(this.href);
		} catch {
			this.info = null;
		}
		this.loading = false;
	}

	/** Texto a mostrar mientras carga / como fallback de enlace externo. */
	private get text(): string {
		return this.authorLabel || this.href;
	}

	/** Nombre localizado de la app destino, con fallback por idioma o al label del registro. */
	private appLabel(info: PlatformLinkInfo): string {
		const fallback = FALLBACK_APP_LABELS[fallbackLocale()][info.appId] || info.appLabel;
		return translate(`platformLink.app.${info.appId}`, fallback);
	}

	/** Título a mostrar: el texto autor-provisto tiene prioridad sobre el resuelto. */
	private title(info: PlatformLinkInfo): string {
		return this.authorLabel || info.title;
	}

	private renderIcon(iconTag?: string) {
		if (iconTag) {
			const IconTag = iconTag;
			return <IconTag size="1rem" class="adc-platform-link__icon shrink-0"></IconTag>;
		}
		return (
			<span class="adc-platform-link__icon shrink-0" aria-hidden="true">
				🔗
			</span>
		);
	}

	render() {
		// Enlace externo o aún no resuelto a microfront: enlace normal.
		if (!this.loading && !this.info) {
			return (
				<a href={this.href} target="_blank" rel="noopener noreferrer" class="text-link underline underline-offset-2 hover:no-underline">
					{this.text}
				</a>
			);
		}

		const chipClass =
			"adc-platform-link inline-flex items-center gap-1 align-baseline max-w-full rounded border border-alt bg-alt/40 px-1.5 py-0.5 text-sm leading-tight no-underline transition-colors hover:bg-alt";

		if (this.loading) {
			return (
				<span class={`${chipClass} animate-pulse`} aria-busy="true" aria-label={this.text}>
					<span class="adc-platform-link__icon shrink-0 opacity-60" aria-hidden="true">
						🔗
					</span>
					<span class="adc-platform-link__title truncate text-text opacity-60">{this.text}</span>
				</span>
			);
		}

		const info = this.info as PlatformLinkInfo;
		const denied = info.status === "denied";
		const deniedText = translate("platformLink.denied", FALLBACK_DENIED[fallbackLocale()]);
		const appLabel = this.appLabel(info);
		const title = this.title(info);

		// Estado "sin acceso": chip inerte (un <a> sin href con onClick es un
		// anti-patrón de accesibilidad, typescript:S6844); no navega ni recibe foco.
		if (denied) {
			return (
				<span
					aria-disabled="true"
					class={`${chipClass} cursor-not-allowed opacity-70`}
					aria-label={`${appLabel}: ${deniedText}`}
					title={`${appLabel} · ${deniedText}`}
				>
					<span class="adc-platform-link__icon shrink-0" aria-hidden="true">
						🔒
					</span>
					<span class="adc-platform-link__title truncate font-medium text-text">{deniedText}</span>
					<span class="adc-platform-link__app shrink-0 text-xs text-muted">{appLabel}</span>
				</span>
			);
		}

		return (
			<a
				href={info.href}
				target="_blank"
				rel="noopener noreferrer"
				class={`${chipClass} text-text`}
				aria-label={`${appLabel}: ${title}`}
				title={`${appLabel} · ${title}`}
			>
				{this.renderIcon(info.iconTag)}
				<span class="adc-platform-link__title truncate font-medium text-text">{title}</span>
				<span class="adc-platform-link__app shrink-0 text-xs text-muted">{appLabel}</span>
			</a>
		);
	}
}
