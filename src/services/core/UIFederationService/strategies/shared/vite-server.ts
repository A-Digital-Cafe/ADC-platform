import * as path from "node:path";
import type { InlineConfig } from "vite";
import type { IBuildContext, IBuildResult } from "../types.js";

/**
 * Construye el bloque `build` para Vite según si el módulo es host (bundle de
 * index.html) o remote (lib mode exponiendo `App.js`).
 */
export function buildViteBuildConfig(
	module: any,
	isHost: boolean,
	outputDir: string,
	externals: (string | RegExp)[],
	appExtension: string,
	globals: Record<string, string>
): any {
	const buildConfig: any = { outDir: outputDir, emptyOutDir: true };

	if (isHost) {
		buildConfig.rollupOptions = {
			input: path.resolve(module.appDir, "index.html"),
			external: externals,
			output: { globals },
		};
	} else {
		buildConfig.lib = {
			entry: path.resolve(module.appDir, `src/App${appExtension}`),
			formats: ["es"],
			fileName: () => "App.js",
		};
		buildConfig.rollupOptions = { external: externals, output: { globals } };
	}

	return buildConfig;
}

/** Arranca `createServer` de Vite y retorna el handle como `IBuildResult`. */
export async function startViteDevServer(context: IBuildContext, viteConfig: InlineConfig): Promise<IBuildResult> {
	const { module, namespace } = context;
	const { createServer } = await import("vite");

	context.logger?.logInfo(`Iniciando Vite Dev Server para ${module.uiConfig.name} [${namespace}]...`);
	const server = await createServer(viteConfig);
	await server.listen();

	const address = server.httpServer?.address();
	const port = typeof address === "object" && address ? address.port : module.uiConfig.devPort;
	context.logger?.logOk(`${module.uiConfig.name} [${namespace}] Vite Dev Server en http://localhost:${port}`);

	return {
		watcher: { kill: async () => server.close() } as any,
		outputPath: undefined,
	};
}

/** Arranca `preview` de Vite (servidor de producción local) con build previo. */
export async function startVitePreviewServer(
	context: IBuildContext,
	viteConfig: InlineConfig,
	outputPath: string | undefined
): Promise<IBuildResult> {
	const { module, namespace } = context;
	const { preview } = await import("vite");

	const previewServer = await preview({
		...viteConfig,
		preview: { port: module.uiConfig.devPort, strictPort: true, cors: true },
	});

	context.logger?.logOk(`${module.uiConfig.name} [${namespace}] Vite Production Server en http://localhost:${module.uiConfig.devPort}`);

	return {
		watcher: { kill: async () => previewServer.close() } as any,
		outputPath,
	};
}
