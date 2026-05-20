import { MicroappCard } from "../components/MicroappCard";

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
		href: "/community",
		icon: <adc-icon-home size="2rem" />,
	},
	{
		id: "identity",
		name: "Identity",
		description: "Gestiona usuarios, roles, grupos y permisos de la plataforma.",
		iconColor: "text-accentcyan",
		href: "/identity",
		icon: <adc-icon-members size="2rem" />,
	},
	{
		id: "org-management",
		name: "Org Management",
		description: "Solicita la creación de organizaciones y gestiona las existentes.",
		iconColor: "text-accentpurple",
		href: "/org-management",
		icon: <adc-icon-org size="2rem" />,
	},
	{
		id: "project-manager",
		name: "Project Manager",
		description: "Organiza proyectos, sprints, tareas y colabora con tu equipo.",
		iconColor: "text-accentgreen",
		href: "/project-manager",
		icon: <adc-icon-app-projects size="2rem" />,
	},
	{
		id: "help-legal",
		name: "Help & Legal",
		description: "Accede a documentación legal, políticas, transparencia y ayuda.",
		iconColor: "text-accentred",
		href: "/help-legal",
		icon: <adc-icon-heart size="2rem" />,
	},
];

export function HomePage() {
	return (
		<section className="relative overflow-hidden">
			{/* background glow */}
			<div
				className="
					pointer-events-none absolute inset-0 opacity-40
					bg-background
				"
			/>

			<div className="relative mx-auto max-w-7xl">
				{/* HERO */}
				<div className="flex min-h-[65vh] flex-col items-center justify-center text-center">
					<h1
						className="
							max-w-4xl !text-7xl font-semibold tracking-tight text-white
							md:text-7xl
						"
					>
						Bienvenido a
						<br />
						<span className="text-accent/50">Abby's Digital Cafe</span>
					</h1>

					<p
						className="
							mt-8 max-w-2xl text-lg leading-relaxed text-white/70
							md:text-xl
						"
					>
						Un ecosistema de herramientas colaborativas y de código abierto para aprender, construir y crecer juntos.
					</p>
				</div>

				{/* APPS */}
				<div id="applications" className="pb-20">
					<div className="mb-12 text-center">
						<h2 className="mb-4 text-4xl font-bold text-white">Nuestras aplicaciones</h2>
						<p className="text-lg text-white/60">Explora las herramientas diseñadas para nuestra comunidad.</p>
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
