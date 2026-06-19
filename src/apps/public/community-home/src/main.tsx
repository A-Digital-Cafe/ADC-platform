import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { redirectIfUnderMaintenance } from "@common/utils/module-availability.js";
import "@ui-library"; // Auto-registra Web Components
import "@ui-library/styles"; // CSS base de la UI Library
import "./styles/tailwind.css"; // Extensiones locales

async function bootstrap() {
	// Si la app está deshabilitada (modules-manager), redirige a la página de mantenimiento.
	if (await redirectIfUnderMaintenance("community-home")) return;

	const container = document.getElementById("root");
	if (container) {
		const root = createRoot(container);
		root.render(
			<React.StrictMode>
				<App />
			</React.StrictMode>
		);
	}
}

void bootstrap();
