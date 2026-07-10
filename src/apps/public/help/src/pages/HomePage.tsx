import "@ui-library/utils/react-jsx";
import PageShell from "../components/PageShell";

export function HomePage() {
	return (
		<PageShell title="Centro de Ayuda" subtitle="Tutoriales, políticas, valores y compromisos públicos de Abby's Digital Cafe.">
			<p>
				Esta sección reúne los tutoriales de la plataforma, nuestras políticas legales, principios éticos y el roadmap de cumplimiento. Es
				la base que usamos para que la plataforma sea usable y respetuosa en todo el mundo.
			</p>

			<section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mt-6" aria-label="Accesos principales">
				<adc-feature-card title="Tutoriales">
					<span slot="icon">
						<adc-icon-apps size="2rem"></adc-icon-apps>
					</span>
					<span>
						<a className="hover:underline" href="/tutorials">
							Guías breves
						</a>{" "}
						para empezar a usar cada aplicación de la plataforma.
					</span>
				</adc-feature-card>
				<adc-feature-card title="Privacidad y datos">
					<span slot="icon">
						<adc-icon-members size="2rem"></adc-icon-members>
					</span>
					<span>
						<a className="hover:underline" href="/privacy">
							GDPR básico
						</a>
						,{" "}
						<a className="hover:underline" href="/cookies">
							política de cookies
						</a>{" "}
						y{" "}
						<a className="hover:underline" href="/terms">
							términos de uso
						</a>
						{"."}
					</span>
				</adc-feature-card>
				<adc-feature-card title="Valores y comunidad">
					<span slot="icon">
						<adc-icon-community size="2rem"></adc-icon-community>
					</span>
					<span>
						<a className="hover:underline" href="/values#espacio-seguro">
							Espacio seguro
						</a>
						,{" "}
						<a className="hover:underline" href="/values#marco-gni">
							marco GNI
						</a>{" "}
						y{" "}
						<a className="hover:underline" href="/hria">
							derechos humanos
						</a>
						{"."}
					</span>
				</adc-feature-card>
				<adc-feature-card title="Ética y roadmap">
					<span slot="icon">
						<adc-icon-learning size="2rem"></adc-icon-learning>
					</span>
					<span>
						<a className="hover:underline" href="/ethics">
							Código de ética
						</a>{" "}
						y{" "}
						<a className="hover:underline" href="/roadmap">
							plan público de cumplimiento
						</a>
						{"."}
					</span>
				</adc-feature-card>
			</section>

			<section className="mt-8" aria-label="Mapa rápido">
				<h2 className="text-2xl font-heading mb-3">Mapa rápido</h2>
				<ul className="grid gap-2 sm:grid-cols-2">
					<li>
						<a className="hover:underline" href="/tutorials">
							Tutoriales de la plataforma
						</a>
					</li>
					<li>
						<a className="hover:underline" href="/privacy">
							Política de Privacidad (GDPR)
						</a>
					</li>
					<li>
						<a className="hover:underline" href="/cookies">
							Política de Cookies
						</a>
					</li>
					<li>
						<a className="hover:underline" href="/terms">
							Términos y Condiciones
						</a>
					</li>
					<li>
						<a className="hover:underline" href="/values">
							Valores y marco GNI
						</a>
					</li>
					<li>
						<a className="hover:underline" href="/hria">
							HRIA de derechos humanos
						</a>
					</li>
					<li>
						<a className="hover:underline" href="/authority-requests">
							Respuesta a autoridades
						</a>
					</li>
					<li>
						<a className="hover:underline" href="/transparency">
							Reporte de transparencia
						</a>
					</li>
					<li>
						<a className="hover:underline" href="/ethics">
							Código de Ética
						</a>
					</li>
					<li>
						<a className="hover:underline" href="/contact">
							Contacto
						</a>
					</li>
					<li>
						<a className="hover:underline" href="/roadmap">
							Roadmap de cumplimiento
						</a>
					</li>
				</ul>
			</section>
		</PageShell>
	);
}
