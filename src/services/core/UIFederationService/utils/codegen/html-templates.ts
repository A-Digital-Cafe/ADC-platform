import * as fs from "node:fs/promises";
import { processHTMLFiles } from "../fs/file-operations.js";

/**
 * Script inline para detección de dark mode basado en preferencias del usuario.
 * Compartido entre templates HTML generados por rspack y archivos standalone.
 */
const DARK_MODE_SCRIPT = `<script>
      (function () {
        const savedTheme = localStorage.getItem('theme');
        if ((!savedTheme && globalThis.matchMedia('(prefers-color-scheme: dark)').matches)
         || savedTheme?.includes("dark")) {
          document.documentElement.setAttribute('dark-mode', '');
        } else {
          document.documentElement.removeAttribute('dark-mode');
        }
      })();
    </script>`;

const REACT_MAIN_ENTRY = `import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
`;

const VUE_MAIN_ENTRY = `import { createApp } from 'vue';
import App from './App.vue';

createApp(App).mount('#root');
`;

/** Inyecta import maps en todos los archivos HTML de un módulo */
export async function injectImportMapsInHTMLs(outputPath: string, importMap: Record<string, string>, logger?: any): Promise<void> {
	const importMapScript = `<script type="importmap">\n${JSON.stringify({ imports: importMap }, null, 2)}\n</script>`;

	await processHTMLFiles(outputPath, async (htmlPath, content) => {
		const updated = content.includes('<script type="importmap">')
			? content.replace(/<script type="importmap">[\s\S]*?<\/script>/, importMapScript)
			: content.replaceAll("</head>", `${importMapScript}\n</head>`);

		await fs.writeFile(htmlPath, updated, "utf-8");
	});

	logger?.logDebug(`Import maps inyectados en HTMLs`);
}

/** Genera el contenido HTML para host apps */
export function generateIndexHtml(name: string, framework: string): string {
	const title = name.charAt(0).toUpperCase() + name.slice(1).replaceAll("-", " ");
	const mainExt = framework === "react" ? ".tsx" : ".ts";

	return `<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    ${DARK_MODE_SCRIPT}
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main${mainExt}"></script>
  </body>
</html>
`;
}

/** Genera el entry point para host apps */
export function generateMainEntryPoint(framework: string): string {
	if (framework === "react") return REACT_MAIN_ENTRY;
	if (framework === "vue") return VUE_MAIN_ENTRY;
	return "";
}
