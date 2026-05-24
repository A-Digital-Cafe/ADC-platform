import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "@ui-library"; // Auto-registra Web Components
import "@ui-library/styles"; // CSS base de la UI Library
import "./styles/tailwind.css"; // Extensiones locales

const container = document.getElementById("root");
if (container) {
	const root = createRoot(container);
	root.render(
		<React.StrictMode>
			<App />
		</React.StrictMode>
	);
}
