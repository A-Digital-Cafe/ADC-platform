import { useEffect, useState } from "react";

type ThemeMode = "light" | "dark";

const STORAGE_KEY = "theme";

function getCookieDomain(): string {
	const host = globalThis.location?.hostname || "";
	// localhost o IP: cookie por host (compartida entre puertos).
	if (!host || host === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return "";
	// subdomain.example.com → .example.com (compartida entre subdominios).
	const parts = host.split(".");
	if (parts.length < 2) return "";
	return "." + parts.slice(-2).join(".");
}

function readCookie(name: string): string | null {
	const match = new RegExp("(^| )" + name + "=([^;]+)").exec(document.cookie);
	return match ? match[2] : null;
}

function applyTheme(mode: ThemeMode) {
	const root = document.documentElement;
	if (mode === "dark") {
		root.setAttribute("dark-mode", "");
	} else {
		root.removeAttribute("dark-mode");
	}
}

function persistTheme(mode: ThemeMode) {
	localStorage.setItem(STORAGE_KEY, mode);
	const domain = getCookieDomain();
	const domainAttr = domain ? `; Domain=${domain}` : "";
	document.cookie = `${STORAGE_KEY}=${mode}; Path=/${domainAttr}; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`;
}

function readInitial(): ThemeMode {
	const saved = readCookie(STORAGE_KEY) || localStorage.getItem(STORAGE_KEY);
	if (saved) return saved.includes("dark") ? "dark" : "light";
	return globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function useTheme() {
	const [mode, setMode] = useState<ThemeMode>("light");

	useEffect(() => {
		const initial = readInitial();
		setMode(initial);
		applyTheme(initial);
	}, []);

	function changeTheme(next: ThemeMode) {
		setMode(next);
		applyTheme(next);
		persistTheme(next);
	}

	return { mode, changeTheme };
}
