import * as fs from "node:fs/promises";
import * as path from "node:path";
import { runCommand } from "../../utils/fs/file-operations.js";

/**
 * Extrae CSS puro removiendo directivas de Tailwind (@import "tailwindcss", @layer, @utility, etc.)
 * Convierte @layer blocks a CSS puro y preserva variables CSS.
 */
function extractPureCss(cssContent: string, moduleName: string): string {
	let result = `/**\n * CSS base para ${moduleName}\n * Generado automáticamente - CSS puro sin directivas de Tailwind\n */\n\n`;

	// Remover @import "tailwindcss" y similares
	let cleaned = cssContent.replaceAll(/@import\s+["']tailwindcss["'];?\s*/g, "");

	const layerBaseMatch = /@layer\s+base\s*\{([\s\S]*?)\n\}/.exec(cleaned);
	if (layerBaseMatch) {
		result += `/* Base styles */\n${layerBaseMatch[1].trim()}\n\n`;
	}

	const layerComponentsMatch = /@layer\s+components\s*\{([\s\S]*?)\n\}/.exec(cleaned);
	if (layerComponentsMatch) {
		result += `/* Component styles */\n${layerComponentsMatch[1].trim()}\n\n`;
	}

	if (!layerBaseMatch && !layerComponentsMatch) {
		cleaned = cleaned.replaceAll(/@utility\s+[\w-]+\s*\{[^}]*\}/g, "");
		cleaned = cleaned.replaceAll(/@keyframes\s+[\w-]+\s*\{[\s\S]*?\}\s*\}/g, "");
		result = cleaned.trim() || result;
	}

	return result;
}

/**
 * Genera `init.js` y `styles.css` en `outputPath` para que la UI library funcione
 * como módulo plug-and-play (auto define custom elements, exporta loader, CSS base).
 */
export async function generateAutoInit(module: any, logger?: any): Promise<void> {
	if (!module.outputPath) return;

	const outputDir = module.outputPath;
	const appDir = module.appDir;
	const moduleName = module.uiConfig.name;

	const initContent = `/**
 * Auto-init para ${moduleName}
 */
import { defineCustomElements } from './loader/index.js';

if (typeof window !== 'undefined') {
	const key = Symbol.for('stencil-init:${moduleName}');
	if (!globalThis[key]) {
		defineCustomElements(window);
		globalThis[key] = true;
	}
}

export * from './loader/index.js';
`;
	await fs.writeFile(path.join(outputDir, "init.js"), initContent, "utf-8");
	logger?.logDebug(`init.js generado para ${moduleName}`);

	const possibleCssPaths = [
		path.join(appDir, "src/global/tailwind.css"),
		path.join(appDir, "src/styles/tailwind.css"),
		path.join(appDir, "src/global/styles.css"),
		path.join(appDir, "src/global/accessibility.css"),
	];

	const stylesPath = path.join(outputDir, "styles.css");
	let combinedCss = "";

	for (const cssPath of possibleCssPaths) {
		try {
			await fs.access(cssPath);
			const cssContent = await fs.readFile(cssPath, "utf-8");
			combinedCss += "\n/* ---- " + path.basename(cssPath) + " ---- */\n";
			combinedCss += extractPureCss(cssContent, moduleName);
			logger?.logDebug(`CSS agregado desde: ${cssPath}`);
		} catch {
			// ignorar si no existe
		}
	}

	if (combinedCss.trim()) {
		await fs.writeFile(stylesPath, combinedCss, "utf-8");
		logger?.logDebug(`styles.css combinado generado para ${moduleName}`);
	} else {
		await fs.writeFile(stylesPath, `/* ${moduleName} - No CSS source found */\n`, "utf-8");
		logger?.logDebug(`styles.css placeholder creado para ${moduleName}`);
	}
}

/**
 * Regenera `utils/react-jsx.ts` con los tipos de los componentes Stencil (opt-in).
 */
export async function regenerateReactJSX(module: any, logger?: any): Promise<void> {
	const appDir: string = module.appDir;
	const dtsPath = path.join(appDir, "src/components.d.ts");
	const reactJsxPath = path.join(appDir, "utils/react-jsx.ts");

	try {
		await fs.access(dtsPath);
		await fs.access(reactJsxPath);
	} catch {
		return;
	}

	const projectRoot = process.cwd();
	const relativePath = path.relative(projectRoot, appDir).replaceAll("\\", "/");
	const scriptPath = path.join(projectRoot, "scripts/generate-react-jsx.mjs");

	try {
		await runCommand("node", [scriptPath, relativePath], projectRoot, logger);
		logger?.logDebug(`react-jsx.ts regenerado para ${module.uiConfig.name}`);
	} catch (err) {
		logger?.logWarn(`No se pudo regenerar react-jsx.ts: ${(err as Error).message}`);
	}
}
