import { Component, Prop } from "@stencil/core";

/**
 * Enlace destacado con accent de color, pensado para dar visibilidad a los
 * enlaces de contenido (externos o cross-app) frente a un `<a>` plano.
 *
 * El texto se provee como children (slot) o, alternativamente, vía el prop
 * `label`. Cuando el destino es externo (otro origen) abre en una pestaña nueva
 * con `rel="noopener noreferrer"` y muestra un icono ↗. La detección de externo
 * es automática por origen y puede forzarse con el prop `external`.
 */
@Component({
	tag: "adc-external-link",
	shadow: false,
})
export class AdcExternalLink {
	/** URL destino (absoluta o relativa). */
	@Prop() href!: string;
	/** Texto del enlace (alternativa al slot/children). */
	@Prop() label?: string;
	/** Fuerza el tratamiento de externo (pestaña nueva + icono). Auto si se omite. */
	@Prop() external?: boolean;

	private get isExternal(): boolean {
		if (this.external !== undefined) return this.external;
		if (!/^https?:\/\//i.test(this.href || "")) return false;
		try {
			return new URL(this.href, globalThis.location?.href).origin !== globalThis.location?.origin;
		} catch {
			return false;
		}
	}

	render() {
		const external = this.isExternal;
		return (
			<a
				href={this.href}
				target={external ? "_blank" : undefined}
				rel={external ? "noopener noreferrer" : undefined}
				class="adc-external-link font-medium text-accent underline decoration-accent/40 decoration-1 underline-offset-2 transition-colors hover:decoration-accent hover:text-accent/80"
			>
				<slot>{this.label}</slot>
				{external && (
					<span class="adc-external-link__icon ml-0.5 text-[0.85em]" aria-hidden="true">
						↗
					</span>
				)}
			</a>
		);
	}
}
