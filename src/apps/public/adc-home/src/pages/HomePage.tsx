import { CafeDividerIcon } from "../components/CafeDividerIcon";
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
		id: "project-manager",
		name: "Project Manager",
		description: "Organiza proyectos, sprints, tareas y colabora con tu equipo.",
		iconColor: "text-accentgreen",
		href: getUrl(3018, "projects.adigitalcafe.com"),
		icon: <adc-icon-app-projects size="2rem" />,
	},
	{
		id: "org-management",
		name: "Org Management",
		description: "Solicita la creación de una organización dentro de la plataforma.",
		iconColor: "text-accentpurple",
		href: getUrl(3020, "org.adigitalcafe.com"),
		icon: <adc-icon-org size="2rem" />,
	},
	{
		id: "identity",
		name: "Identity",
		description: "Gestiona usuarios, roles, grupos y permisos de tu organización.",
		iconColor: "text-accentcyan",
		href: getUrl(3014, "identity.adigitalcafe.com"),
		icon: <adc-icon-members size="2rem" />,
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
				<div className="flex min-h-[45vh] flex-col items-center justify-center text-center">
					<h1 className="max-w-4xl text-7xl! font-semibold tracking-tight text-text md:text-7xl">
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
								<CafeDividerIcon />
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
