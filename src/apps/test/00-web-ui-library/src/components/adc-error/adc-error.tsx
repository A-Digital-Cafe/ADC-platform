import { Component, Prop } from "@stencil/core";

/**
 * Componente de error centrado para mostrar cuando una aplicación falla
 */
@Component({
	tag: "adc-error",
	styleUrl: "adc-error.css",
	shadow: true,
})
export class AdcError {
	/**
	 * Código de error HTTP (ej: 404, 500, 503)
	 */
	@Prop() httpError?: number;

	/**
	 * Título personalizado del error
	 */
	@Prop() errorTitle?: string;

	/**
	 * Descripción personalizada del error
	 */
	@Prop() errorDescription?: string;

	/**
	 * Color del icono y borde (por defecto #ef4444 - rojo)
	 */
	@Prop() color: string = "#ef4444";

	private getDefaultTitle(): string {
		if (this.httpError) {
			switch (this.httpError) {
				case 404:
					return "Recurso no encontrado";
				case 500:
					return "Error interno del servidor";
				case 503:
					return "Servicio no disponible";
				case 502:
					return "Gateway no disponible";
				default:
					return `Error ${this.httpError}`;
			}
		}
		return this.errorTitle || "Ha ocurrido un error";
	}

	private getDefaultDescription(): string {
		if (this.httpError) {
			switch (this.httpError) {
				case 404:
					return "El recurso solicitado no se encuentra disponible.";
				case 500:
					return "Estamos experimentando problemas técnicos. Intenta nuevamente más tarde.";
				case 503:
					return "El servicio no está disponible en este momento. Intenta nuevamente en unos minutos.";
				case 502:
					return "No se pudo conectar con el servicio. Verifica tu conexión.";
				default:
					return "Se produjo un error inesperado.";
			}
		}
		return this.errorDescription || "Por favor, intenta nuevamente más tarde.";
	}

	render() {
		return (
			<div class="error-container">
				<div class="error-content">
					<div class="error-icon" style={{ borderColor: this.color }}>
						<svg
							width="48"
							height="48"
							viewBox="0 0 24 24"
							fill="none"
							stroke={this.color}
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<circle cx="12" cy="12" r="10"></circle>
							<line x1="12" y1="8" x2="12" y2="12"></line>
							<line x1="12" y1="16" x2="12.01" y2="16"></line>
						</svg>
					</div>

					{!!this.httpError && (
						<div class="error-code" style={{ color: this.color }}>
							{this.httpError}
						</div>
					)}

					<h2 class="error-title">{this.getDefaultTitle()}</h2>
					<p class="error-description">{this.getDefaultDescription()}</p>

					<slot name="actions"></slot>
				</div>
			</div>
		);
	}
}
