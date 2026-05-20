import { MicroappCard } from "../components/MicroappCard";
import { getUrl } from "@common/utils/url-utils.js";

type AccentColor = "text-accentorange" | "text-accentcyan" | "text-accentpurple" | "text-accentgreen" | "text-accentred";

interface Microapp {
	id: string;
	name: string;
	description: string;
	iconColor: AccentColor;
	href: string;
	icon: React.ReactNode;
}

const MICROAPPS: Microapp[] = [
	{
		id: "community",
		name: "Community Home",
		description: "Descubre rutas de aprendizaje, contenidos y actividades para crecer junto con la comunidad.",
		iconColor: "text-accentorange",
		href: getUrl(3010, "adigitalcafe.com"),
		icon: <adc-icon-home size="2rem" />,
	},
	{
		id: "identity",
		name: "Identity",
		description: "Gestiona usuarios, roles, grupos y permisos de la plataforma.",
		iconColor: "text-accentcyan",
		href: getUrl(3014, "identity.adigitalcafe.com"),
		icon: <adc-icon-members size="2rem" />,
	},
	{
		id: "org-management",
		name: "Org Management",
		description: "Solicita la creación de organizaciones y gestiona las existentes.",
		iconColor: "text-accentpurple",
		href: getUrl(3020, "org.adigitalcafe.com"),
		icon: <adc-icon-org size="2rem" />,
	},
	{
		id: "project-manager",
		name: "Project Manager",
		description: "Organiza proyectos, sprints, tareas y colabora con tu equipo.",
		iconColor: "text-accentgreen",
		href: getUrl(3018, "projects.adigitalcafe.com"),
		icon: <adc-icon-app-projects size="2rem" />,
	},
	{
		id: "help-legal",
		name: "Help & Legal",
		description: "Accede a documentación legal, políticas, transparencia y ayuda.",
		iconColor: "text-accentred",
		href: getUrl(3022, "help.adigitalcafe.com"),
		icon: <adc-icon-heart size="2rem" />,
	},
];

export function HomePage() {
	return (
		<section className="relative overflow-hidden">
			{/* background glow */}
			<div className="pointer-events-none absolute inset-0 opacity-40 bg-background" />
			<div className="relative mx-auto max-w-7xl">
				{/* HERO */}
				<div className="flex min-h-[70vh] flex-col items-center justify-center text-center">
					<h1 className="max-w-4xl !text-7xl font-semibold tracking-tight text-text md:text-7xl">
						Bienvenido a
						<br />
						<span className="text-accent/70">Abby's Digital Cafe</span>
					</h1>

					<p className="mt-8 max-w-2xl text-lg leading-relaxed text-text/80 md:text-xl">
						Un ecosistema de herramientas colaborativas y de código abierto para aprender, construir y crecer juntos.
					</p>

					<div className="mt-16 flex w-full items-center justify-center">
						<div className="flex w-full max-w-3xl items-center">
							<div className="h-px flex-1 bg-accent/80" />

							<div className="mx-2 flex h-30 w-30 items-center justify-center text-accent/80 rounded-full">
								<svg
									xmlns="http://www.w3.org/2000/svg"
									fill="currentColor"
									height="full"
									width="full"
									version="1.1"
									id="图层_1"
									viewBox="0 0 40 40"
									enable-background="new 0 0 40 40"
								>
									<g>
										<g>
											<g>
												<g>
													<path d="M21.1,26.3h-2.3c-2.5,0-4.6-1.8-5-4.2l-0.8-4.4c0-0.3,0-0.5,0.2-0.7c0.2-0.2,0.4-0.3,0.7-0.3h12.1      c0.3,0,0.5,0.1,0.7,0.3c0.2,0.2,0.2,0.5,0.2,0.7l-0.8,4.4C25.7,24.6,23.6,26.3,21.1,26.3z M14.1,17.8l0.7,4.2c0.3,2,2,3.4,4,3.4      h2.3c2,0,3.7-1.4,4-3.4l0.7-4.2H14.1z" />
												</g>
												<g>
													<path d="M25.9,18.4c0.5-0.5,1.6-0.9,2.5,0c0.6,0.6,0.7,1.8,0.1,2.7c-0.4,0.7-1.1,1.1-1.9,1.1c-0.3,0-0.6-0.1-1-0.2l0.3-1      c1,0.3,1.5-0.1,1.7-0.5c0.3-0.5,0.3-1.2,0-1.5c-0.5-0.5-0.9-0.1-1.1,0L25.9,18.4z" />
												</g>
											</g>
											<g>
												<g>
													<path d="M17.8,16.1c-0.2,0-0.3-0.1-0.4-0.2c0-0.1-0.3-0.5-0.3-1.1s0.3-1.1,0.3-1.1l0,0c0,0,0.2-0.3,0.2-0.6      c0-0.3-0.2-0.6-0.2-0.6c-0.1-0.2-0.1-0.5,0.2-0.7c0.2-0.1,0.5-0.1,0.7,0.2c0,0.1,0.3,0.5,0.3,1.1c0,0.6-0.3,1.1-0.3,1.1l0,0      c0,0-0.2,0.3-0.2,0.6c0,0.3,0.2,0.6,0.2,0.6c0.1,0.2,0.1,0.5-0.2,0.7C17.9,16.1,17.9,16.1,17.8,16.1z" />
												</g>
												<g>
													<path d="M20,16.1c-0.2,0-0.3-0.1-0.4-0.2c0,0-0.3-0.5-0.3-1.1s0.3-1.1,0.3-1.1l0,0c0,0,0.2-0.3,0.2-0.6c0-0.3-0.2-0.6-0.2-0.6      c-0.1-0.2-0.1-0.5,0.2-0.7c0.2-0.1,0.5-0.1,0.7,0.2c0,0.1,0.3,0.5,0.3,1.1c0,0.6-0.3,1.1-0.3,1.1l0,0c0,0-0.2,0.3-0.2,0.6      c0,0.3,0.2,0.6,0.2,0.6c0.1,0.2,0.1,0.5-0.2,0.7C20.2,16.1,20.1,16.1,20,16.1z" />
												</g>
												<g>
													<path d="M22.2,16.1c-0.2,0-0.3-0.1-0.4-0.2c0,0-0.3-0.5-0.3-1.1s0.3-1.1,0.3-1.1l0,0c0,0,0.2-0.3,0.2-0.6c0-0.3-0.2-0.6-0.2-0.6      c-0.1-0.2-0.1-0.5,0.2-0.7s0.5-0.1,0.7,0.2c0,0.1,0.3,0.5,0.3,1.1c0,0.6-0.3,1.1-0.3,1.1l0,0c0,0-0.2,0.3-0.2,0.6      c0,0.3,0.2,0.6,0.2,0.6c0.1,0.2,0.1,0.5-0.2,0.7C22.4,16.1,22.3,16.1,22.2,16.1z" />
												</g>
											</g>
											<g>
												<path d="M26.5,28.3h-13c-0.3,0-0.5-0.2-0.5-0.5s0.2-0.5,0.5-0.5h13c0.3,0,0.5,0.2,0.5,0.5S26.8,28.3,26.5,28.3z" />
											</g>
										</g>
									</g>
								</svg>
							</div>

							<div className="h-px flex-1 bg-accent/80" />
						</div>
					</div>
				</div>

				{/* APPS */}
				<div id="applications" className="pb-20">
					<div className="mb-12 text-center">
						<h2 className="mb-3 text-4xl font-bold text-heading">Nuestras aplicaciones</h2>

						<p className="text-lg text-text">Explora las herramientas diseñadas para nuestra comunidad.</p>
					</div>
					<div className="flex flex-wrap justify-center gap-6">
						{MICROAPPS.map((app) => (
							<div key={app.id} className="w-full md:w-[calc(50%-12px)] xl:w-[calc(33.333%-16px)]">
								<MicroappCard
									name={app.name}
									description={app.description}
									icon={app.icon}
									iconColor={app.iconColor}
									href={app.href}
								/>
							</div>
						))}
					</div>
				</div>
			</div>
		</section>
	);
}
