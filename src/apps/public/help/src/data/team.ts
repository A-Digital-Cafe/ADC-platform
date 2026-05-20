type RoleColor = "text-accentorange" | "text-accentcyan" | "text-accentpurple";

export interface TeamMember {
	name: string;
	username?: string;
	role: string;
	description?: string;
	image?: string;
	roleColor?: RoleColor;
}

export const FOUNDER: TeamMember = {
	name: "Abigail Palmero",
	username: "@abbytec",
	role: "Founder / CEO",
	roleColor: "text-accentorange",
	description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
	image: "",
};

export const DEV_MEMBER: TeamMember = {
	name: "Ailen Franco",
	role: "Dev Contributor",
	roleColor: "text-accentpurple",
	description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
	image: "",
};

export const COMMUNITY_MEMBERS: TeamMember[] = [
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
