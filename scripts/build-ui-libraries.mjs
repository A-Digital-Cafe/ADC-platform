#!/usr/bin/env node
/* global console */
/**
 * Compila todas las UI libraries Stencil del proyecto (principal + presets)
 * y regenera sus artefactos runtime (init.js, styles.css, react-jsx.ts).
 *
 * Las libs de presets se saltan con warning si el preset no está clonado
 * (los presets son opcionales).
 */
import { existsSync, readdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const projectRoot = process.cwd();

const UI_LIBRARIES = ["src/apps/public/00-adc-ui-library", "presets/adc-media/apps/media-ui-library"];

function run(command, args, cwd) {
	const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
	if (result.status !== 0) {
		console.error(`[build:ui] Falló: ${command} ${args.join(" ")} (cwd: ${cwd})`);
		process.exit(result.status ?? 1);
	}
}

for (const libDir of UI_LIBRARIES) {
	const absDir = path.resolve(projectRoot, libDir);
	if (!existsSync(absDir)) {
		console.warn(`[build:ui] Omitiendo ${libDir} (no clonado)`);
		continue;
	}

	console.log(`[build:ui] Compilando ${libDir}...`);
	run("npx", ["stencil", "build"], absDir);
	run("node", ["scripts/generate-ui-library-runtime.mjs", libDir], projectRoot);
	run("node", ["scripts/generate-react-jsx.mjs", libDir], projectRoot);
}

// Stencil emite .js junto a fuentes compartidas fuera del árbol de una lib; se limpian los pares
// emitidos (ver `UIFederationService/strategies/shared/stencil-output.ts`).
cleanupStrays(path.resolve(projectRoot, "src/common"));
cleanupStrays(path.resolve(projectRoot, "src/apps/public/00-adc-ui-library/utils"));

function cleanupStrays(dir) {
	if (!existsSync(dir)) return;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name !== "node_modules") cleanupStrays(full);
			continue;
		}
		if (!entry.name.endsWith(".js")) continue;
		const tsTwin = full.slice(0, -3) + ".ts";
		if (!existsSync(tsTwin)) continue;
		rmSync(full, { force: true });
		rmSync(full + ".map", { force: true });
		console.log(`[build:ui] Artefacto stray eliminado: ${path.relative(projectRoot, full)}`);
	}
}
