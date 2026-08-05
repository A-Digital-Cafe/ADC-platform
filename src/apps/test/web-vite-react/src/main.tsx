import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./styles/probe.css";

const container = document.getElementById("root");
if (container) createRoot(container).render(<App />);
