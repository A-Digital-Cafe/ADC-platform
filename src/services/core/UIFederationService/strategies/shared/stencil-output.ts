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
 * Borra artefactos que Stencil emite JUNTO a fuentes compartidas fuera del árbol
 * de la lib (ej: una lib en presets/ que importa tipos de `src/common` deja
 * `learning.js`/`.js.map` al lado del `.ts`). Regla segura por convención del
 * repo: bajo `src/` nunca conviven `X.ts` y `X.js` legítimos.
 */
export async function cleanupStrayEmits(logger?: any): Promise<void> {
	const roots = [path.resolve(process.cwd(), "src/common"), path.resolve(process.cwd(), "src/apps/public/00-adc-ui-library/utils")];
	for (const root of roots) {
		await cleanupStrayEmitsIn(root, logger);
	}
}

async function cleanupStrayEmitsIn(dir: string, logger?: any): Promise<void> {
	let entries;
	try {
		entries = await fs.readdir(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name !== "node_modules") await cleanupStrayEmitsIn(full, logger);
			continue;
		}
		if (!entry.name.endsWith(".js")) continue;
		const tsTwin = full.slice(0, -3) + ".ts";
		try {
			await fs.access(tsTwin);
		} catch {
			continue; // .js legítimo (sin fuente .ts)
		}
		await fs.rm(full, { force: true });
		await fs.rm(full + ".map", { force: true });
		logger?.logDebug(`Artefacto stray eliminado: ${full}`);
	}
}

/**
 * `custom-elements` va en la lista aunque su output target ya no se genere: un árbol construido
 * antes de ese cambio lo tiene en disco y nadie lo iba a borrar.
 *
 * Salidas del target `dist` de Stencil que **no consume nadie**: ni el build (los aliases van a
 * `init.js` → `loader/` → `../esm/`) ni el navegador. Stencil no permite desactivarlas por config
 * —`dist` incluye `dist-collection`, `dist-types` y la variante CJS—, así que se borran después.
 *
 * `esm/`, `loader/`, el directorio de chunks lazy, `init.js`, `index.js` y `styles.css` NO se tocan.
 */
const UNUSED_DIST_DIRS = ["cjs", "collection", "types", "custom-elements"];
/** `index.cjs.js` es la puerta de entrada de `cjs/`: sin él queda un archivo que importa a la nada. */
const UNUSED_DIST_FILES = ["index.cjs.js"];

/**
 * Recorta el directorio publicado de una UI library en producción.
 *
 * El directorio de salida se sirve entero por HTTP, así que todo lo que sobra ahí es código
 * legible tuyo dado de baja a internet (`collection/` es el TypeScript transpilado sin minificar).
 * En desarrollo no se toca nada: ahí sí sirve para depurar.
 *
 * Los `.map` se barren igual aunque `stencil-config` ya no los genere en producción: un árbol
 * construido antes de ese cambio, o con la variable puesta a mano, dejaría los viejos publicados.
 */
export async function prunePublishedArtifacts(module: any, logger?: any): Promise<void> {
	if (process.env.NODE_ENV !== "production" || !module.outputPath) return;

	const outputDir: string = module.outputPath;
	let removed = 0;

	for (const dir of UNUSED_DIST_DIRS) {
		const full = path.join(outputDir, dir);
		try {
			await fs.rm(full, { recursive: true, force: true });
			removed++;
		} catch (error: any) {
			logger?.logDebug(`No se pudo podar ${full}: ${error.message}`);
		}
	}
	for (const file of UNUSED_DIST_FILES) {
		await fs.rm(path.join(outputDir, file), { force: true });
	}

	const maps = await removeSourceMapsIn(outputDir, logger);
	logger?.logDebug(`Poda de ${module.uiConfig?.name ?? outputDir}: ${removed} directorio(s) y ${maps} source map(s).`);
}

/** Borra recursivamente los `*.map` de un árbol. Devuelve cuántos sacó. */
async function removeSourceMapsIn(dir: string, logger?: any): Promise<number> {
	let entries;
	try {
		entries = await fs.readdir(dir, { withFileTypes: true });
	} catch {
		return 0;
	}
	let count = 0;
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			count += await removeSourceMapsIn(full, logger);
			continue;
		}
		if (!entry.name.endsWith(".map")) continue;
		await fs.rm(full, { force: true });
		count++;
	}
	return count;
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
