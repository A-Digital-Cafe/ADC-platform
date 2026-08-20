import { Component, Prop, Event, EventEmitter, Host } from "@stencil/core";

/**
 * Engranaje de configuración del header. **Sólo el botón**: el modal con las pestañas lo pinta la
 * app, igual que la campana de notificaciones pinta su menú desde el preset.
 *
 * Va así y no con un slot para los paneles porque las apps son React: al reubicar Stencil los
 * children slotteados fuera del nodo que React cree padre, el siguiente render revienta con
 * `insertBefore … is not a child of this node`. Dejando el contenido en el árbol de la app (un
 * `adc-modal`, que se posiciona fijo y no depende de dónde cuelgue) no hay nada que reubicar.
 *
 * Arranca oculto: lo enciende la app que tenga algo que configurar, poniéndole `enabled`.
 */
@Component({
	tag: "adc-settings-menu",
	shadow: false,
})
export class AdcSettingsMenu {
	/** Lo prende la app montada. Sin esto no se pinta: una app sin preferencias no muestra el botón. */
	@Prop() enabled: boolean = false;

	/** Texto accesible del botón (y su tooltip). */
	@Prop() label: string = "Configuración";

	/** Refleja si el modal de la app está abierto, para el `aria-expanded`. */
	@Prop() expanded: boolean = false;

	/** Click en el engranaje. La app decide abrir o cerrar. */
	@Event() adcSettingsToggle!: EventEmitter<void>;

	render() {
		if (!this.enabled) return null;
		return (
			<Host class="relative inline-flex">
				<button
					type="button"
					class="relative inline-flex items-center justify-center w-10 h-10 rounded-full hover:bg-black/10 transition-colors cursor-pointer"
					aria-label={this.label}
					title={this.label}
					aria-expanded={this.expanded ? "true" : "false"}
					onClick={() => this.adcSettingsToggle.emit()}
				>
					<adc-icon-settings class="w-6 h-6"></adc-icon-settings>
				</button>
			</Host>
		);
	}
}
