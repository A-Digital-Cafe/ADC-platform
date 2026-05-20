interface MicroappCardProps {
	name: string;
	description: string;
	iconColor: string;
	icon: React.ReactNode;
	href: string;
}

export function MicroappCard({ name, description, iconColor, icon, href }: MicroappCardProps) {
	return (
		<a
			href={href}
			className="
			
				group relative flex flex-col overflow-hidden rounded-3xl
				border border-white/10
				bg-surface
				p-6 transition-all duration-300
				hover:-translate-y-1
				hover:border-white/20
				hover:shadow-cozy
				h-80
			"
		>
			{/* subtle glow */}
			<div
				className="
					pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300
					group-hover:opacity-100
					bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.06),transparent_40%)]
				"
			/>

			{/* icon */}
			<div
				className={`
					border mb-5 flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl
					bg-background/50 text-2xl backdrop-blur-sm
					${iconColor}
				`}
			>
				{icon}
			</div>

			{/* content */}
			<div className="flex-1">
				<h3 className="mb-2 text-xl font-heading font-semibold tracking-tight text-white">{name}</h3>

				<p className="text-sm leading-relaxed text-white/65">{description}</p>
			</div>

			{/* arrow */}
			<div
				className="
					mt-6 flex justify-end text-xl text-white/40
					transition-all duration-300
					group-hover:translate-x-1
					group-hover:text-white/80
				"
			>
				→
			</div>
		</a>
	);
}
