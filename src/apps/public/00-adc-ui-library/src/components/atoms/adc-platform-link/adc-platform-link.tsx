import { Component, Prop, State, Watch, Element } from "@stencil/core";

import { resolvePlatformLinkInfo, type PlatformLinkInfo } from "../../../../utils/platform-links.js";

/**
 * Chip de enlace de plataforma estilo Jira / Google Docs.
 *
 * Recibe un `href` que apunta a un microfront de la plataforma y, cargando bajo
 * demanda el resolver federado que esa app expone en su `config.json`
 * (`federationExposes`), muestra el icono de la app, su nombre y el título de la
 * entidad destino (artículo, tarea, tablero…). Estados: cargando, ok, sin
 * acceso (`denied`) y fallback.
 *
 * Si la URL no resuelve a ningún microfront conocido, se degrada a un enlace
 * normal con el texto provisto en `label`.
 */
@Component({
	tag: "adc-platform-link",
	shadow: false,
})
export class AdcPlatformLink {
	/** URL destino (absoluta o relativa). */
	@Prop() href!: string;
	/** Texto del enlace en el documento, usado como fallback. */
	@Prop() label?: string;

	@Element() hostEl!: HTMLElement;

	@State() info: PlatformLinkInfo | null = null;
	@State() loading = true;

	@Watch("href")
	onHrefChange() {
		this.resolve();
	}

	componentWillLoad() {
		return this.resolve();
	}

	private async resolve() {
		this.loading = true;
		try {
			this.info = await resolvePlatformLinkInfo(this.href);
		} catch {
			this.info = null;
		}
		this.loading = false;
	}

	private get text(): string {
		return (this.label || "").trim() || this.href;
	}

	/** Estado "sin acceso": el chip no navega ni propaga el click a routers SPA. */
	private readonly blockNavigation = (ev: MouseEvent) => {
		ev.preventDefault();
		ev.stopPropagation();
	};

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

		return (
			<a
				href={denied ? undefined : info.href}
				target={denied ? undefined : "_blank"}
				rel={denied ? undefined : "noopener noreferrer"}
				role={denied ? "link" : undefined}
				aria-disabled={denied ? "true" : undefined}
				tabindex={denied ? "-1" : undefined}
				onClick={denied ? this.blockNavigation : undefined}
				class={`${chipClass} ${denied ? "cursor-not-allowed opacity-70" : "text-text"}`}
				aria-label={`${info.appLabel}: ${denied ? "Sin acceso" : info.title}`}
				title={denied ? `${info.appLabel} · Sin acceso` : `${info.appLabel} · ${info.title}`}
			>
				{denied ? (
					<span class="adc-platform-link__icon shrink-0" aria-hidden="true">
						🔒
					</span>
				) : (
					this.renderIcon(info.iconTag)
				)}
				<span class="adc-platform-link__title truncate font-medium text-text">{denied ? "Sin acceso" : info.title}</span>
				<span class="adc-platform-link__app shrink-0 text-xs text-muted">{info.appLabel}</span>
			</a>
		);
	}
}
