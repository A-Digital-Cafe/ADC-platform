#!/usr/bin/env bun
/**
 * Empaqueta React como ESM servible desde el propio origen, para que el import map no tenga que
 * apuntar a `esm.sh`.
 *
 * Motivo: cada page-load resolvía `react`/`react-dom` contra un CDN de terceros, así que la IP de
 * cada visitante llegaba a ese tercero antes de que la persona hiciera nada. Auto-hospedarlo lo
 * elimina del todo (y de paso saca `https://esm.sh` del CSP).
 *
 * La salida va a `src/common/public/vendor/react/`, que la UI federation ya sirve en `/` como
 * fallback global de todas las apps. Los bundles se cruzan entre sí por especificador desnudo
 * (`react`), que resuelve el propio import map: así hay una sola copia de React en la página.
 */
import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "src/common/public/vendor/react");
const SHIM_DIR = join(ROOT, "scripts/.vendor-entries");

/** Cada entrada es un especificador del import map; `external` mantiene una sola copia en runtime. */
const ENTRIES = [
	{ file: "react.js", entry: "react", external: [] },
	{ file: "jsx-runtime.js", entry: "react/jsx-runtime", external: ["react"] },
	{ file: "jsx-dev-runtime.js", entry: "react/jsx-dev-runtime", external: ["react"] },
	{ file: "react-dom.js", entry: "react-dom", external: ["react"] },
	{ file: "react-dom-client.js", entry: "react-dom/client", external: ["react", "react-dom"] },
];

await rm(OUT_DIR, { recursive: true, force: true });
await rm(SHIM_DIR, { recursive: true, force: true });
await mkdir(OUT_DIR, { recursive: true });
await mkdir(SHIM_DIR, { recursive: true });

try {
	for (const { file, entry, external } of ENTRIES) {
		// Dos detalles no obvios del shim:
		//  - hace falta un `export *` explícito, o el bundler no ve ninguna exportación viva y
		//    tree-shakea el paquete entero a cero bytes;
		//  - importa la RUTA RESUELTA y no el especificador, porque `external: ["react"]` también
		//    matchea `react/jsx-runtime` y el bundle se volvería un re-export de sí mismo.
		const resolved = Bun.resolveSync(entry, ROOT);
		const shim = join(SHIM_DIR, file);
		await Bun.write(shim, `export * from ${JSON.stringify(resolved)};\nexport { default } from ${JSON.stringify(resolved)};\n`);

		const result = await Bun.build({
			entrypoints: [shim],
			target: "browser",
			format: "esm",
			minify: true,
			external,
			define: { "process.env.NODE_ENV": '"production"' },
		});
		if (!result.success) {
			console.error(`[vendor] falló el bundle de ${entry}:`);
			for (const log of result.logs) console.error(log);
			process.exit(1);
		}
		const code = await result.outputs[0].text();
		await Bun.write(join(OUT_DIR, file), code);
		console.log(`[vendor] ${entry} → vendor/react/${file} (${(code.length / 1024).toFixed(1)} KB)`);
	}
} finally {
	await rm(SHIM_DIR, { recursive: true, force: true });
}
