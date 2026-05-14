import { Component, Prop, Event, EventEmitter, State } from "@stencil/core";

@Component({
	tag: "adc-star-rating",
	shadow: false,
})
export class AdcStarRating {
	@Prop() average?: number | null;
	@Prop() count?: number | null;
	@Prop() myRating?: number | null;
	@Prop() canRate: boolean = false;
	@Prop() pending: boolean = false;

	@State() mounted: boolean = false;

	@Event() adcRate!: EventEmitter<number>;

	componentDidLoad() {
		this.mounted = true;
	}

	private readonly handleClick = (rating: number) => {
		if (!this.canRate || this.pending || !this.mounted) return;
		// Clicking the already-selected star toggles it off (unrate → emit 0)
		this.adcRate.emit(this.myRating === rating ? 0 : rating);
	};

	private readonly isDisabled = (): boolean => {
		return !this.canRate || this.pending || !this.mounted;
	};

	private getDisplayRating(): number {
		return this.myRating ?? this.average ?? 0;
	}

	render() {
		const disabled = this.isDisabled();
		const displayRating = this.getDisplayRating();

		const clasification = (
			<span class="ml-2 text-sm" aria-label="Calificación promedio">
				{typeof this.average === "number" ? this.average.toFixed(1) : "0.0"} ({this.count ?? 0})
			</span>
		);

		const star = (i: number) => <span class={displayRating >= i ? "text-yellow-400" : "text-gray-300"}>★</span>;

		// Nota: `<input type="radio">` es un void element y NO puede tener hijos; el navegador
		// descarta cualquier contenido interno, por eso antes se veía como puntos de radio nativos
		// en lugar de estrellas. Usamos `<button role="radio">` que es accesible y permite hijos.
		return disabled ? (
			<div class="flex items-center gap-1">
				{[1, 2, 3, 4, 5].map((i) => (
					<span key={`star-${i}`} class="text-4xl leading-none cursor-default" aria-hidden="true">
						{star(i)}
					</span>
				))}
				{clasification}
			</div>
		) : (
			<div class="flex items-center gap-1" role="radiogroup" aria-label="Calificación">
				{[1, 2, 3, 4, 5].map((i) => (
					<button
						type="button"
						key={`star-${i}`}
						role="radio"
						class="text-4xl leading-none focus:outline-none cursor-pointer bg-transparent border-0 p-0"
						aria-label={`Calificar con ${i} estrellas`}
						aria-checked={this.myRating === i ? "true" : "false"}
						onClick={() => this.handleClick(i)}
					>
						{star(i)}
					</button>
				))}
				{clasification}
			</div>
		);
	}
}
