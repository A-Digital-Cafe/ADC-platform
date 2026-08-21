import { Component, Prop } from "@stencil/core";

export interface NotFoundAction {
	label: string;
	href: string;
}

/**
 * Pantalla de "no encontrado" para el `default` del router de una app.
 *
 * Usage:
 *   <adc-not-found
 *     description="La dirección que abriste no existe o fue movida."
 *     actions='[{"label":"Ir al inicio","href":"/"},{"label":"Ver artículos","href":"/articles"}]' />
 *
 * Va acompañada de `uiModule.spaRoutes` en el `config.json`: es el kernel el que contesta 404
 * (sirviendo este mismo `index.html`), y esto es lo que se ve. Sin `spaRoutes` el status sigue
 * siendo 200 y para un crawler la URL inventada es una página real.
 *
 * Los links son `<a>` de verdad, no navegación del router: es un estado terminal y poco frecuente,
 * y así la página siguiente se pide de nuevo al server con su status correcto.
 */
@Component({
	tag: "adc-not-found",
	shadow: false,
})
export class AdcNotFound {
	/** Código grande. `404` por defecto; sirve igual para un 403 o un 410. */
	@Prop() code: string = "404";

	@Prop() heading: string = "Página no encontrada";

	@Prop() description: string = "La dirección que abriste no existe o fue movida.";

	/** Links de salida; el primero se pinta como acción principal. Array o JSON string. */
	@Prop() actions: NotFoundAction[] | string = [];

	private static readonly keyPrefix = "not-found-action-";

	private get parsedActions(): NotFoundAction[] {
		if (typeof this.actions === "string") {
			try {
				return JSON.parse(this.actions);
			} catch {
				return [];
			}
		}
		return this.actions || [];
	}

	render() {
		const actions = this.parsedActions;

		return (
			<div class="w-full flex flex-col items-center text-center px-4 py-16">
				<p class="font-heading font-bold text-6xl text-muted mb-2" aria-hidden="true">
					{this.code}
				</p>
				<h1 class="font-heading font-bold text-2xl text-text mb-2">{this.heading}</h1>
				<p class="text-muted max-w-prose">{this.description}</p>

				{actions.length > 0 && (
					<div class="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
						{actions.map((action, idx) => (
							<a
								key={AdcNotFound.keyPrefix + idx}
								href={action.href}
								class={
									idx === 0
										? "px-4 py-2 rounded-xxl bg-primary text-tprimary font-medium"
										: "px-4 py-2 rounded-xxl bg-alt text-text font-medium"
								}
							>
								{action.label}
							</a>
						))}
					</div>
				)}
			</div>
		);
	}
}
