import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { RegisteredUIModule } from "../types.js";

/**
 * Configuración de Tailwind CSS v4 para módulos UI
 * Genera archivos CSS con @source directives para escanear los paths correctos
 */

/**
 * Genera la configuración de tema de Tailwind (solo theme, sin content)
 */
function getThemeConfig(): Record<string, any> {
	return {
		theme: {
			extend: {
				colors: {
					"adc-primary": {
						50: "#eff6ff",
						100: "#dbeafe",
						200: "#bfdbfe",
						300: "#93c5fd",
						400: "#60a5fa",
						500: "#0066cc",
						600: "#0052a3",
						700: "#003d7a",
						800: "#002952",
						900: "#001429",
					},
					"adc-success": {
						50: "#ecfdf5",
						100: "#d1fae5",
						200: "#a7f3d0",
						300: "#6ee7b7",
						400: "#34d399",
						500: "#10b981",
						600: "#059669",
						700: "#047857",
						800: "#065f46",
						900: "#064e3b",
					},
					"adc-warning": {
						50: "#fffbeb",
						100: "#fef3c7",
						200: "#fde68a",
						300: "#fcd34d",
						400: "#fbbf24",
						500: "#f59e0b",
						600: "#d97706",
						700: "#b45309",
						800: "#92400e",
						900: "#78350f",
					},
					"adc-danger": {
						50: "#fef2f2",
						100: "#fee2e2",
						200: "#fecaca",
						300: "#fca5a5",
						400: "#f87171",
						500: "#ef4444",
						600: "#dc2626",
						700: "#b91c1c",
						800: "#991b1b",
						900: "#7f1d1d",
					},
				},
				fontFamily: {
					sans: ["system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],
				},
				spacing: {
					"adc-sm": "0.5rem",
					"adc-md": "1rem",
					"adc-lg": "1.5rem",
					"adc-xl": "2rem",
				},
				borderRadius: {
					adc: "0.375rem",
				},
			},
		},
	};
}

/**
 * Genera el archivo CSS de entrada para Tailwind v4
 * Incluye @source directives para escanear los paths correctos
 */
export async function generateTailwindConfig(
	module: RegisteredUIModule,
	registeredModules: Map<string, RegisteredUIModule>,
	configDir: string,
	logger?: any
): Promise<string> {
	const namespace = module.namespace || "default";
	const sourcePaths: string[] = [];

	// Agregar path del módulo actual
	sourcePaths.push(`${module.appDir}/src`);

	// Incluir todas las dependencias declaradas en uiDependencies
	let uiLibraryPresetPath: string | null = null;
	const uiDependencies = module.uiConfig.uiDependencies || [];
	for (const depName of uiDependencies) {
		const depModule = registeredModules.get(depName);
		if (depModule) {
			// Agregar path de TODAS las dependencias (UI libraries y remotes)
			sourcePaths.push(`${depModule.appDir}/src`);
			logger?.logDebug(`[Tailwind v4] ${module.uiConfig.name} incluye @source de: ${depModule.uiConfig.name}`);

			// Buscar el preset solo de UI libraries Stencil
			if (depModule.uiConfig.framework === "stencil" && !uiLibraryPresetPath) {
				const presetPath = path.join(depModule.appDir, "utils", "tailwind-preset.js");
				try {
					await fs.access(presetPath);
					uiLibraryPresetPath = presetPath;
					logger?.logDebug(`[Tailwind v4] ${module.uiConfig.name} usa preset de ${depModule.uiConfig.name}`);
				} catch {
					// No hay preset
				}
			}
		}
	}

	await fs.mkdir(configDir, { recursive: true });

	const themeConfigPath = path.join(configDir, "tailwind.config.js");
	let themeContent: string;

	if (uiLibraryPresetPath) {
		// Importar el preset de la UI library
		themeContent = `/** @type {import('tailwindcss').Config} */
import uiLibraryPreset from '${uiLibraryPresetPath.replaceAll("\\", "/")}';

export default {
	presets: [uiLibraryPreset],
	theme: {
		extend: {}
	}
};
`;
	} else {
		// Usar theme por defecto si no hay preset
		const themeConfig = getThemeConfig();
		themeContent = `/** @type {import('tailwindcss').Config} */
export default ${JSON.stringify(themeConfig, null, 2)};
`;
	}

	await fs.writeFile(themeConfigPath, themeContent, "utf-8");

	// Generar CSS de entrada con @source directives (Tailwind v4)
	const sourceDirectives = sourcePaths.map((p) => `@source "${p.replaceAll("\\", "/")}";`).join("\n");

	// Buscar el archivo tailwind.css original del usuario para importar sus extensiones
	const userTailwindCss = path.join(module.appDir, "src", "styles", "tailwind.css");
	let userCssImport = "";
	try {
		// Leer el contenido del CSS del usuario para incluir sus extensiones (sin el @import
		// tailwindcss).
		const userCssContent = await fs.readFile(userTailwindCss, "utf-8");
		// Extraer solo las extensiones: cualquier línea menos el @import "tailwindcss"
		const extensions = userCssContent
			.split("\n")
			.filter((line) => !line.includes('@import "tailwindcss"') && !line.includes("@import 'tailwindcss'"))
			.join("\n")
			.trim();
		if (extensions) {
			userCssImport = `\n/* Extensiones del usuario */\n${extensions}`;
		}
	} catch {
		// No hay archivo tailwind.css del usuario
	}

	const cssContent = `/**
 * Tailwind CSS v4 - Generado automáticamente
 * Módulo: ${module.uiConfig.name} [${namespace}]
 */
@import "tailwindcss";

/* Paths a escanear para clases de Tailwind */
${sourceDirectives}

/* Configuración de tema */
@config "${themeConfigPath.replaceAll("\\", "/")}";
${userCssImport}
`;

	const cssPath = path.join(configDir, "tailwind-entry.css");
	await fs.writeFile(cssPath, cssContent, "utf-8");
	logger?.logDebug(`Tailwind v4 CSS generado para ${module.uiConfig.name} [${namespace}] en ${cssPath}`);

	return cssPath;
}

/**
 * Genera el archivo postcss.config.js para Tailwind CSS v4
 */
export async function generatePostCSSConfig(_tailwindCssPath: string, configDir: string, logger?: any): Promise<string> {
	const configContent = `import tailwindcss from '@tailwindcss/postcss';
import autoprefixer from 'autoprefixer';

export default {
	plugins: [
		tailwindcss(),
		autoprefixer(),
	],
};
`;

	const configPath = path.join(configDir, "postcss.config.mjs");
	await fs.writeFile(configPath, configContent, "utf-8");
	logger?.logDebug(`PostCSS config generado en ${configPath}`);

	return configPath;
}

/**
 * Verifica si un módulo tiene Tailwind habilitado en sus sharedLibs
 */
export function hasTailwindEnabled(module: RegisteredUIModule): boolean {
	const sharedLibs = module.uiConfig.sharedLibs || [];
	return sharedLibs.includes("tailwind") || sharedLibs.includes("tailwindcss");
}
