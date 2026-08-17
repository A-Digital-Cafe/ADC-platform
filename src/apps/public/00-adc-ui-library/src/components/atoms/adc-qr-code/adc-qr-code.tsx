import { Component, Prop, State, Watch, Host } from "@stencil/core";
import { encodeQr } from "./qr-encode";

/** Módulos claros alrededor del símbolo. Menos de 4 y varios lectores no lo encuentran. */
const QUIET_ZONE = 4;

/**
 * Código QR renderizado como SVG inline, sin dependencias ni peticiones.
 *
 * @example
 * <adc-qr-code value="otpauth://totp/..." size="220" label="Escaneá con tu autenticador" />
 */
@Component({
	tag: "adc-qr-code",
	shadow: false,
})
export class AdcQrCode {
	/** Contenido a codificar. Máximo 213 bytes UTF-8 (versión 10, corrección M). */
	@Prop() value!: string;

	/** Lado del símbolo en píxeles (incluye la zona de silencio). */
	@Prop() size: number = 200;

	/** Texto alternativo. Sin él, el QR queda como imagen decorativa para un lector de pantalla. */
	@Prop() label?: string;

	@State() private modules: boolean[][] | null = null;
	@State() private error: string | null = null;

	componentWillLoad() {
		this.encode();
	}

	@Watch("value")
	encode() {
		try {
			this.modules = this.value ? encodeQr(this.value) : null;
			this.error = null;
		} catch (err: any) {
			this.modules = null;
			this.error = err?.message || "No se pudo generar el código";
		}
	}

	render() {
		if (this.error) {
			return (
				<Host class="inline-block">
					<p class="text-sm text-terror">{this.error}</p>
				</Host>
			);
		}
		if (!this.modules) return <Host class="inline-block" />;

		const count = this.modules.length;
		const side = count + QUIET_ZONE * 2;

		// Un solo `path` con un subtrazado por módulo oscuro: miles de <rect> hacen que el navegador
		// arme miles de nodos, y acá el símbolo se redibuja entero cada vez que cambia el secreto.
		const path = this.modules
			.flatMap((row, r) => row.map((dark, c) => (dark ? `M${c + QUIET_ZONE} ${r + QUIET_ZONE}h1v1h-1z` : "")))
			.join("");

		return (
			<Host class="inline-block">
				<svg
					width={this.size}
					height={this.size}
					viewBox={`0 0 ${side} ${side}`}
					shape-rendering="crispEdges"
					role={this.label ? "img" : "presentation"}
					aria-label={this.label}
				>
					{/* Fondo claro y módulos oscuros SIEMPRE, también en tema oscuro: un QR invertido
					    lo leen algunos escáneres y otros no, y acá fallar significa no poder entrar. */}
					<rect width={side} height={side} fill="#ffffff" />
					<path d={path} fill="#000000" />
				</svg>
			</Host>
		);
	}
}
