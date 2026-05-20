import "@ui-library/utils/react-jsx";
import PageShell from "../components/PageShell";

type RoleColor = "text-accentorange" | "text-accentcyan" | "text-accentpurple";

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
}

const FOUNDER: TeamMember = {
	name: "Abigail Palmero",
	username: "@abbytec",
	role: "Founder / CEO",
	roleColor: "text-accentorange",
	description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
	image: "",
};

const DEV_MEMBER: TeamMember = {
	name: "Ailen Franco",
	role: "Dev Contributor",
	roleColor: "text-accentpurple",
	description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
	image: "",
};

const COMMUNITY_MEMBERS: TeamMember[] = [
	{
		name: "Salwa",
		username: "@SoySalwa",
		role: "Discord Moderator",
		roleColor: "text-accentcyan",
		description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
		image: "",
	},
	{
		name: "Hormiga Dev",
		username: "@HormigaDev",
		role: "Discord Moderator",
		roleColor: "text-accentcyan",
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

function TeamCard({ member, initials }: TeamCardProps) {
	const cardClassName = `group rounded-lg border border-accent/15 bg-surface/85 backdrop-blur-sm transition-all duration-300 text-center shadow-sm
		max-w-[160px]`;

	const avatarClassName = `mx-auto rounded-full overflow-hidden bg-primary text-tprimary flex items-center justify-center font-bold
		w-24 h-24 text-lg`;

	return (
		<article className={cardClassName}>
			<div className="px-2 py-2">
				{/* Avatar */}
				<div className={avatarClassName}>
					{member.image ? <img src={member.image} alt={member.name} className="w-full h-full object-cover" /> : initials}
				</div>

				{/* Info */}
				<div className="mt-1.5">
					<h2 className={`font-heading !text-xl font-medium !m-0`}>{member.name}</h2>

					{member.username && <p className="text-text/50 font-mono text-[8px] !m-0">{member.username}</p>}

					<p className={`mt-0.5 text-xs ${member.roleColor}`}>{member.role}</p>

					<div className="w-6 h-px bg-accent/30 mx-auto mt-1.5 rounded-full" />

					{member.description && <p className="mt-1 text-xs leading-4 text-text/60">{member.description}</p>}
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
			<div className="mt-8">
				{/* PERSONAL */}
				<section>
					<div className="mb-4">
						<adc-divider text="Personal"></adc-divider>
					</div>

					<div className="flex gap-4 flex-wrap justify-center">
						<TeamCard member={FOUNDER} initials={getInitials(FOUNDER.name)} />
						<TeamCard member={DEV_MEMBER} initials={getInitials(DEV_MEMBER.name)} />
						{COMMUNITY_MEMBERS.map((member) => (
							<TeamCard key={member.username} member={member} initials={getInitials(member.name)} />
						))}
					</div>
				</section>
			</div>
		</PageShell>
	);
}
