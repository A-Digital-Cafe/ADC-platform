import "@ui-library/utils/react-jsx";
import PageShell from "../components/PageShell";

type RoleColor = "text-orange-400" | "text-sky-400" | "text-purple-400";

interface TeamMember {
	name: string;
	username?: string;
	role: string;
	description?: string;
	image?: string;
	roleColor?: RoleColor;
}

interface TeamCardProps {
	member: TeamMember;
	initials: string;
	featured?: boolean;
}

const FOUNDER: TeamMember = {
	name: "Abigail Palmero",
	username: "@abbytec",
	role: "Founder / CEO",
	roleColor: "text-orange-400",
	description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
	image: "",
};

const DEV_MEMBER: TeamMember = {
	name: "Ailen Franco",
	role: "Dev Contributor",
	roleColor: "text-purple-400",
	description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
	image: "",
};

const COMMUNITY_MEMBERS: TeamMember[] = [
	{
		name: "Salwa",
		username: "@SoySalwa",
		role: "Discord Moderator",
		roleColor: "text-sky-400",
		description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
		image: "",
	},
	{
		name: "Hormiga Dev",
		username: "@HormigaDev",
		role: "Discord Moderator",
		roleColor: "text-sky-400",
		description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
		image: "",
	},
];

function getInitials(name: string) {
	return name
		.split(" ")
		.map((word) => word[0])
		.join("");
}

function TeamCard({ member, initials, featured = false }: TeamCardProps) {
	const cardClassName = `group rounded-2xl border border-accent/15 bg-surface/90 backdrop-blur-sm transition-all duration-300 text-center shadow-[0_0_25px_rgba(255,140,0,0.03)]
		${featured ? "max-w-[250px]" : "max-w-[220px]"}`;

	const avatarClassName = `mx-auto rounded-full overflow-hidden bg-primary text-tprimary flex items-center justify-center font-bold shadow-md
		${featured ? "w-40 h-40 text-3xl" : "w-32 h-32 text-2xl"}`;

	return (
		<article className={cardClassName}>
			<div className="px-3 py-3">
				{/* Avatar */}
				<div className={avatarClassName}>
					{member.image ? <img src={member.image} alt={member.name} className="w-full h-full object-cover" /> : initials}
				</div>

				{/* Info */}
				<div className="mt-2">
					<h2 className={`font-heading font-semibold text-text leading-tight !m-0 ${featured ? "text-lg" : "text-base"}`}>
						{member.name}
					</h2>

					{member.username && <p className="text-text/55 font-mono text-xs !m-0">{member.username}</p>}

					<p className={`mt-1 text-sm font-medium ${member.roleColor}`}>{member.role}</p>

					<div className="w-10 h-[2px] bg-accent/40 mx-auto mt-2 rounded-full" />

					{member.description && <p className="mt-2 text-xs leading-6 text-text/65">{member.description}</p>}
				</div>
			</div>
		</article>
	);
}

export function TeamPage() {
	return (
		<PageShell
			title="Nuestro equipo"
			subtitle="Personas que colaboran y forman parte del proyecto."
			declaration="informational"
			breadcrumb={[{ label: "Inicio", href: "/" }, { label: "Equipo" }]}
		>
			<div className="mt-8 space-y-10">
				{/* FOUNDER */}
				<section>
					<div className="flex items-center gap-3 mb-5">
						<span className="text-accent font-semibold tracking-[0.2em] text-sm uppercase">Founder</span>

						<div className="h-px flex-1 bg-accent/20" />
					</div>

					<div className="flex justify-center">
						<TeamCard member={FOUNDER} initials={getInitials(FOUNDER.name)} featured />
					</div>
				</section>

				{/* DEVELOPMENT */}
				<section>
					<div className="flex items-center gap-3 mb-5">
						<span className="text-accent font-semibold tracking-[0.2em] text-sm uppercase">Development</span>

						<div className="h-px flex-1 bg-accent/20" />
					</div>

					<div className="flex justify-center">
						<TeamCard member={DEV_MEMBER} initials={getInitials(DEV_MEMBER.name)} />
					</div>
				</section>

				{/* COMMUNITY */}
				<section>
					<div className="flex items-center gap-3 mb-5">
						<span className="text-accent font-semibold tracking-[0.2em] text-sm uppercase">Community</span>

						<div className="h-px flex-1 bg-accent/20" />
					</div>

					<div className="flex gap-4 flex-wrap justify-center">
						{COMMUNITY_MEMBERS.map((member) => (
							<TeamCard key={member.username} member={member} initials={getInitials(member.name)} />
						))}
					</div>
				</section>
			</div>
		</PageShell>
	);
}
