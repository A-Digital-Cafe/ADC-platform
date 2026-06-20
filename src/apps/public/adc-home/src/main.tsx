import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { redirectIfUnderMaintenance } from "@common/utils/module-availability.js";
import "@ui-library"; // Auto-registra Web Components
import "@ui-library/styles"; // CSS base de la UI Library
import "./styles/tailwind.css"; // Extensiones locales

if (!(await redirectIfUnderMaintenance("adc-home"))) {
	const container = document.getElementById("root");
	if (container) {
		createRoot(container).render(
			<React.StrictMode>
				<App />
			</React.StrictMode>
		);
	}
}
