import { router } from "@common/utils/router.js";

export function Navigation({ currentPath }: { readonly currentPath: string }) {
	const handleNavigate = (path: string) => {
		if (path !== currentPath) {
			router.navigate(path);
		}
	};

	const getButtonClasses = (path: string) => {
		const baseClasses = "nav-btn";
		const activeClasses = currentPath === path ? "nav-btn--active" : "";
		return `${baseClasses} ${activeClasses}`.trim();
	};

	return (
		<nav className="flex gap-3 py-4 border-b-2 border-gray-200 mb-5">
			<button type="button" onClick={() => handleNavigate("/")} className={getButtonClasses("/")}>
				Inicio
			</button>
			<button type="button" onClick={() => handleNavigate("/users")} className={getButtonClasses("/users")}>
				Usuarios
			</button>
			<button type="button" onClick={() => handleNavigate("/config")} className={getButtonClasses("/config")}>
				Configuración
			</button>
		</nav>
	);
}
