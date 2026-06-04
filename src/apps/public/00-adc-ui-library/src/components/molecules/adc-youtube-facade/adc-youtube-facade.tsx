import { Component, Prop, State } from "@stencil/core";

/**
 * Componente YouTube Facade para carga perezosa de videos
 * Muestra una thumbnail clickeable en lugar de cargar el iframe inmediatamente
 * Mejora performance al evitar cargar el player de YouTube hasta que sea necesario
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
					src={`https://www.youtube.com/embed/${id}?autoplay=1`}
					title={this.videoTitle}
					allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
					allowFullScreen
					class="rounded-xxl max-w-full"
					loading="lazy"
				/>
			);

		// URL de la thumbnail de YouTube (calidad hqdefault para consistencia con temp-ui)
		const thumbnailUrl = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

		// Renderizar facade (thumbnail clickeable con dimensiones fijas 480x320)
		return (
			<div
				class="relative overflow-hidden cursor-pointer group mx-auto rounded-xxl shadow-cozy bg-gray-100"
				style={{ width: "480px", height: "320px" }}
				onClick={this.activate}
				onKeyPress={this.handleKeyPress}
				role="button"
				tabIndex={0}
				aria-label={`Reproducir video: ${this.videoTitle}`}
			>
				{/* Imagen de fondo (thumbnail) */}
				<img src={thumbnailUrl} alt={this.videoTitle} class="absolute inset-0 w-full h-full object-cover" loading="lazy" />

				{/* Overlay oscuro */}
				<span class="absolute inset-0 bg-black/30 group-hover:bg-black/20 transition-colors" />

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
