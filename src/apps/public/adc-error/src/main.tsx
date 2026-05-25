import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "@ui-library";
import "@ui-library/styles";
import "./styles/tailwind.css";

const container = document.getElementById("root");
if (container) {
	const root = createRoot(container);
	root.render(
		<React.StrictMode>
			<App />
		</React.StrictMode>
	);
}
