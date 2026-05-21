import "@ui-library/utils/react-jsx";
import PageShell from "../components/PageShell";
import { TeamMember, FOUNDER, DEV_MEMBER, COMMUNITY_MEMBERS } from "../data/team";

interface TeamCardProps {
	member: TeamMember;
	initials: string;
}

function getInitials(name: string) {
	return name
		.split(" ")
		.map((word) => word[0])
		.join("");
}

function TeamCard({ member, initials }: TeamCardProps) {
	const cardClassName = `group rounded-lg border border-accent/10 bg-surface/50 backdrop-blur-sm transition-all duration-300 text-center shadow-sm max-w-[170px]`;

	const avatarClassName = `mx-auto rounded-full overflow-hidden bg-primary text-tprimary flex items-center justify-center font-bold w-24 h-24 text-lg`;

	return (
		<article className={cardClassName}>
			<div className="px-2 py-4">
				{/* Avatar */}
				<div className={avatarClassName}>
					{member.image ? <img src={member.image} alt={member.name} className="w-full h-full object-cover" /> : initials}
				</div>

				{/* Info */}
				<div className="mt-1.5">
					<h2 className={`font-heading !text-xl font-medium !m-0`}>{member.name}</h2>

					{member.username && <p className="text-text/50 font-mono text-[8px] !text-sm !m-0">{member.username}</p>}

					<p className={`!m-0 ${member.roleColor}`}>{member.role}</p>

					<div className="w-6 h-px bg-accent/30 mx-auto mt-1.5 rounded-full" />

					{member.description && <p className="text-text/60">{member.description}</p>}
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
						{COMMUNITY_MEMBERS.map((member, idx) => (
							<TeamCard key={`community-${idx}`} member={member} initials={getInitials(member.name)} />
						))}
					</div>
				</section>
			</div>
		</PageShell>
	);
}
