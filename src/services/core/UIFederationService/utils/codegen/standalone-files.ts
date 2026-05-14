import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ILogger } from "../../../../../interfaces/utils/ILogger.js";
import type { UIModuleConfig } from "../../../../../interfaces/modules/IUIModule.js";
import { parseFramework } from "../../strategies/index.js";
import { generateIndexHtml, generateMainEntryPoint } from "./html-templates.js";

async function ensureFile(filePath: string, contentFactory: () => string, label: string, logger: ILogger): Promise<void> {
	try {
		await fs.access(filePath);
		logger.logDebug(`${label} existente preservado`);
	} catch {
		await fs.writeFile(filePath, contentFactory(), "utf-8");
		logger.logDebug(`${label} generado`);
	}
}

/** Genera index.html y main.{tsx,ts} para hosts react/vue si no existen. */
export async function generateStandaloneFiles(appDir: string, config: UIModuleConfig, logger: ILogger): Promise<void> {
	const { baseFramework } = parseFramework(config.framework || "astro");
	if (baseFramework !== "react" && baseFramework !== "vue") return;

	const indexHtmlPath = path.join(appDir, "index.html");
	await ensureFile(indexHtmlPath, () => generateIndexHtml(config.name, baseFramework), `index.html para ${config.name}`, logger);

	const mainExt = baseFramework === "react" ? ".tsx" : ".ts";
	const mainPath = path.join(appDir, "src", `main${mainExt}`);
	await ensureFile(mainPath, () => generateMainEntryPoint(baseFramework), `src/main${mainExt} para ${config.name}`, logger);
}
