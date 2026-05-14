const BRAND = {
	name: "Abby's Digital Cafe",
	discordVanity: "vShXpyWTTq",
	description:
		"Abby's Digital Cafe es una comunidad destinada a programadores y estudiantes, enfocada en aprender nuevas tecnologías y compartir código de forma libre 🧡",
	slogan: "Una taza de código con tintes de amistad",
};

const DESCRIPTION =
	"Somos una comunidad digital donde compartimos conocimiento y código abierto con buen café. Ofrecemos ayuda gratuita para proyectos de código (hablar con abbytec en Discord) siempre que podamos compartir el proceso de creación en stream, GitHub y/o videos, o animar a tus compañeros a proponer modificaciones (PRs). (Para proyectos pagos, también pueden consultar precios por privado.)";

export function HomePage() {
	return (
		<div>
			<section
				id="home"
				className="flex flex-col items-center text-center max-w-6xl mx-auto"
				aria-label="Página principal de Abby's Digital Cafe"
			>
				<h1 className="text-3xl font-heading mb-4">{BRAND.name}</h1>
				<p className="mb-4 contain-content">{DESCRIPTION}</p>

				<h2 className="text-2xl font-heading mt-8 mb-2">🧡 Únete a nuestro servidor de discord 🧡</h2>
				<adc-text>Trae tu taza y comparte código con nosotr@s.</adc-text>
				<adc-button href={`https://discord.gg/${BRAND.discordVanity}`} class="mt-4">
					Entrar al Discord
				</adc-button>

				<adc-quote class="pr-16">{BRAND.slogan}</adc-quote>
			</section>

			<section className="grid gap-4 sm:grid-cols-3 mt-12" aria-label="Características principales">
				<adc-feature-card title="Comunidad">
					<span slot="icon">
						<adc-icon-community size="2rem"></adc-icon-community>
					</span>
					<span>Espacio para compartir y apoyarnos mutuamente.</span>
				</adc-feature-card>
				<adc-feature-card title="Aprendizaje">
					<span slot="icon">
						<adc-icon-learning size="2rem"></adc-icon-learning>
					</span>
					<span>Contenido claro para crecer paso a paso.</span>
				</adc-feature-card>
				<adc-feature-card title="Open Source">
					<span slot="icon">
						<adc-icon-opensource size="2rem"></adc-icon-opensource>
					</span>
					<span>Proyectos libres para colaborar y aprender.</span>
				</adc-feature-card>
			</section>

			<section className="text-center space-y-4 mt-12" aria-label="Música para programar">
				<h2 className="text-2xl font-heading">Durante tu sesión de código: Cozy Beats</h2>
				<adc-text>Música lofi para acompañar tus sesiones de código.</adc-text>
				<div className="flex justify-center max-w-2xl mx-auto">
					<adc-youtube-facade src="SXySxLgCV-8" title="Cozy Beats - Música lofi"></adc-youtube-facade>
				</div>
			</section>

			<section className="grid gap-4 sm:grid-cols-3 mt-12" aria-label="Testimonios de la comunidad">
				<adc-testimonial-card author="@lokitomiko">
					Buena comunidad activa para la gente que hay. Se disfruta, únanse. (desde Discord)
				</adc-testimonial-card>
				<adc-testimonial-card author="@soysalwa">
					Eehh. No sé. :xd: Mentira, "Cuando no sepas que hacer o donde ir, recuerda que un café caliente soluciona muchos dolores de
					cabeza, únete al café digital de Abby."
				</adc-testimonial-card>
				<adc-testimonial-card author="Dev C">Gran comunidad para programar y relajarse.</adc-testimonial-card>
			</section>

			<section className="text-center space-y-4 mt-12" aria-label="Redes sociales">
				<h2 className="text-2xl font-heading">Nuestras redes</h2>
				<div className="flex justify-center gap-3 flex-wrap">
					<adc-button href={`https://discord.gg/${BRAND.discordVanity}`}>Discord</adc-button>
					<adc-button href="https://twitch.tv/digital_cafe">Twitch</adc-button>
					<adc-button href="https://youtube.com/@a_digital_cafe">YouTube</adc-button>
					<adc-button href="https://www.instagram.com/a.digital.cafe">Instagram</adc-button>
					<adc-button href="https://ceneka.net/digital_cafe">Donaciones</adc-button>
				</div>
			</section>
		</div>
	);
}
