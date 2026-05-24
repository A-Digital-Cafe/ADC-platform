type RoleColor = "text-accentorange" | "text-accentcyan" | "text-accentpurple";

export interface TeamMember {
	name: string;
	username?: string;
	role: string;
	description?: string;
	image?: string;
	href?: string;
	roleColor?: RoleColor;
}

export const FOUNDER: TeamMember = {
	name: "Abigail Palmero",
	username: "@abbytec",
	role: "Founder / CEO",
	roleColor: "text-accentorange",
	description: "No se que hago acá, me obligaron o algo así. Pero aguante el café, typescript y el sushi.",
	href: "https://abbytec.dev.ar",
	image: "https://cdn.discordapp.com/avatars/220683580467052544/eea19befaea1bd160fa646f67a0d1b91.png",
};

export const DEV_MEMBER: TeamMember = {
	name: "Ailen Franco",
	role: "Dev Contributor",
	roleColor: "text-accentpurple",
	description: "Desarrolladora web apasionada por crear experiencias digitales únicas y funcionales.",
	href: "https://portfolio-wheat-mu-60.vercel.app/",
	image: "https://avatars.githubusercontent.com/u/93718475?v=4",
};

export const COMMUNITY_MEMBERS: TeamMember[] = [
	{
		name: "Salwa",
		username: "@SoySalwa",
		role: "Discord Moderator",
		roleColor: "text-accentcyan",
		description: "C++ Developer | C++ Enthusiast | C++ Content Creator | C++ Lover | C++ Advocate",
		href: "https://soysalwa.pages.dev/",
		image: "https://soysalwa.pages.dev/FurinaL.png",
	},
	{
		name: "Hormiga Dev",
		username: "@HormigaDev",
		role: "Discord Moderator",
		roleColor: "text-accentcyan",
		description: "La aptitud te ayuda a empezar la carrera, la actitud determina la distancia que recorres y la huella que dejas.",
		href: "https://www.hormiga.dev/",
		image: "https://www.hormiga.dev/assets/avatar.png",
	},
];
