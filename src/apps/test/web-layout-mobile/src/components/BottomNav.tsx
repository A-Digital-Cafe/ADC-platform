import { router } from "@common/utils/router.js";

export function BottomNav({ currentPath }: { readonly currentPath: string }) {
	const handleNavigate = (path: string) => {
		if (path !== currentPath) {
			router.navigate(path);
		}
	};

	const navItems = [{ path: "/", icon: "🏠", label: "Inicio" }];

	return (
		<nav
			style={{
				position: "fixed",
				bottom: 0,
				left: 0,
				right: 0,
				display: "flex",
				justifyContent: "space-around",
				alignItems: "center",
				padding: "12px 0 24px", // Padding extra para safe area
				background: "linear-gradient(180deg, rgba(26, 32, 44, 0.95) 0%, rgba(13, 17, 23, 0.98) 100%)",
				backdropFilter: "blur(10px)",
				borderTop: "1px solid rgba(255, 255, 255, 0.05)",
			}}
		>
			{navItems.map((item) => (
				<button
					key={item.path}
					type="button"
					onClick={() => handleNavigate(item.path)}
					style={{
						display: "flex",
						flexDirection: "column",
						alignItems: "center",
						gap: "4px",
						padding: "8px 24px",
						background: "transparent",
						border: "none",
						borderRadius: "12px",
						cursor: "pointer",
						color: currentPath === item.path ? "#805ad5" : "#718096",
						transition: "all 0.2s ease",
					}}
				>
					<span
						style={{
							fontSize: "24px",
							filter: currentPath === item.path ? "drop-shadow(0 0 8px rgba(128, 90, 213, 0.5))" : "none",
						}}
					>
						{item.icon}
					</span>
					<span
						style={{
							fontSize: "11px",
							fontWeight: currentPath === item.path ? "600" : "400",
							letterSpacing: "0.5px",
						}}
					>
						{item.label}
					</span>
				</button>
			))}
		</nav>
	);
}
