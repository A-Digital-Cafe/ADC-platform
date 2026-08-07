import { Component, Prop, State } from "@stencil/core";

/**
 * Componente YouTube Facade para carga perezosa de videos
 * Muestra un cartel clickeable en lugar de cargar el iframe inmediatamente
 *
 * Hasta que la persona no toca "reproducir" NO se contacta ningún host de terceros: por eso
 * el cartel es local (nada de `i.ytimg.com`, que ya en el render le filtraría la IP y el video
 * mirado a Google) y el player se incrusta en `youtube-nocookie.com`. Si se quiere una miniatura
 * real hay que auto-hospedarla y pasarla por `poster`.
 */
@Component({
	tag: "adc-youtube-facade",
	shadow: false,
})
export class AdcYoutubeFacade {
	/** URL o ID del video de YouTube (acepta URL completa o solo el ID) */
	@Prop() src!: string;

	/** Título del video para accesibilidad */
	@Prop({ attribute: "title" }) videoTitle: string = "Video de YouTube";

	/** Miniatura propia (auto-hospedada). Sin ella se muestra un cartel local. */
	@Prop() poster?: string;

	/** Ancho del contenedor (opcional, por defecto responsive) */
	@Prop() width?: string;

	/** Alto del contenedor (opcional, por defecto responsive 16:9) */
	@Prop() height?: string;

	/** Estado que controla si el iframe está activo */
	@State() activated: boolean = false;

	/** Extrae el video ID de una URL de YouTube o retorna el valor si ya es un ID */
	private get videoId(): string | null {
		if (!this.src) return null;

		// Si ya es un ID (11 caracteres alfanuméricos)
		if (/^[a-zA-Z0-9_-]{11}$/.test(this.src)) {
			return this.src;
		}

		// Extraer de URLs de YouTube
		const patterns = [/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&?/]+)/];
		for (const pattern of patterns) {
			const match = pattern.exec(this.src);
			if (match) return match[1];
		}

		return null;
	}

	/**
	 * Activa el iframe cuando el usuario hace click
	 */
	private readonly activate = () => {
		this.activated = true;
	};

	/**
	 * Maneja el evento de teclado para accesibilidad
	 */
	private readonly handleKeyPress = (event: KeyboardEvent) => {
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			this.activate();
		}
	};

	render() {
		const id = this.videoId;

		// Si no se pudo extraer el ID, no renderizar nada
		if (!id) return null;

		// Renderizar iframe cuando está activado
		if (this.activated)
			return (
				<iframe
					width="560"
					height="315"
					src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1`}
					title={this.videoTitle}
					allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
					allowFullScreen
					class="rounded-xxl max-w-full"
					loading="lazy"
				/>
			);

		return (
			<div
				class="relative overflow-hidden cursor-pointer group mx-auto rounded-xxl shadow-cozy bg-linear-to-br from-slate-700 to-slate-900 w-full max-w-[480px]"
				style={{ aspectRatio: "3 / 2" }}
				onClick={this.activate}
				onKeyPress={this.handleKeyPress}
				role="button"
				tabIndex={0}
				aria-label={`Reproducir video: ${this.videoTitle}`}
			>
				{this.poster && (
					<img src={this.poster} alt={this.videoTitle} class="absolute inset-0 w-full h-full object-cover" loading="lazy" />
				)}

				<span class="absolute inset-0 bg-black/30 group-hover:bg-black/20 transition-colors" />

				<span class="absolute bottom-0 inset-x-0 p-3 text-white text-sm font-medium text-center line-clamp-2">{this.videoTitle}</span>

				{/* Botón de play centrado */}
				<span class="absolute inset-0 flex items-center justify-center">
					<span class="inline-flex items-center justify-center h-16 w-16 rounded-full bg-primary/90 text-white shadow">
						{/* Ícono de play SVG */}
						<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
							<path d="M8 5v14l11-7z" />
						</svg>
					</span>
				</span>
			</div>
		);
	}
}
