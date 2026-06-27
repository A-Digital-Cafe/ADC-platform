import * as fs from "node:fs/promises";
import type { UIModuleConfig } from "../../../../../interfaces/modules/IUIModule.js";
import { processHTMLFiles } from "../fs/file-operations.js";

/**
 * Genera el `<script>` de auto-redirect entre variantes responsive (desktop ⇄
 * mobile) a partir de `uiModule.responsive`. Corre en el `<head>` ANTES del
 * bundle: si el dispositivo no coincide con `variant`, redirige a la
 * `counterpart` conservando ruta/query/hash. Señal: UA-Client-Hints / UA regex
 * (barato, sin red) reforzado por viewport (puntero coarse + pantalla angosta +
 * retrato). `?view=desktop|mobile` fija la elección (persistida) y gana sobre la
 * heurística; `?via=auto` marca un salto automático y corta loops (máx. 1 salto).
 * El origen destino sigue el mismo criterio que `getPlatformAppOrigin`: en
 * dev/LAN por `devPort`, en prod por `subdomain` (protocolo/puerto heredados).
 * Devuelve "" si el módulo no declara `responsive`.
 */
export function buildResponsiveRedirectScript(responsive: UIModuleConfig["responsive"]): string {
	if (!responsive || (responsive.variant !== "desktop" && responsive.variant !== "mobile")) return "";
	const self = responsive.variant;
	const port = responsive.counterpart.devPort;
	const subdomain = responsive.counterpart.subdomain;

	return String.raw`<script>
      (function () {
        var SELF = ${JSON.stringify(self)};
        var OTHER_PORT = ${JSON.stringify(port)};
        var OTHER_SUBDOMAIN = ${JSON.stringify(subdomain)};

        function isMobileDevice() {
          var nav = navigator;
          var uaData = nav.userAgentData;
          if (uaData && typeof uaData.mobile === 'boolean') return uaData.mobile;
          if (/Android|iPhone|iPod|Windows Phone|webOS|BlackBerry|IEMobile|Opera Mini/i.test(nav.userAgent || '')) return true;
          var coarse = !!(globalThis.matchMedia && globalThis.matchMedia('(pointer: coarse)').matches);
          var w = globalThis.innerWidth || screen.width || 0;
          var h = globalThis.innerHeight || screen.height || 0;
          return coarse && Math.min(w, h) <= 768 && h >= w;
        }

        function otherOrigin(loc) {
          var host = loc.hostname;
          var priv = host === 'localhost' || host === '127.0.0.1' ||
            /^192\.168\./.test(host) || /^10\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
          if (priv) return 'http://' + host + ':' + OTHER_PORT;
          var proto = loc.protocol === 'https:' ? 'https:' : 'http:';
          return proto + '//' + OTHER_SUBDOMAIN + '.adigitalcafe.com' + (loc.port ? ':' + loc.port : '');
        }

        try {
          var loc = globalThis.location;
          var qs = new URLSearchParams(loc.search);
          if (qs.get('via') === 'auto') {
            qs.delete('via');
            history.replaceState(null, '', loc.pathname + (qs.toString() ? '?' + qs : '') + loc.hash);
            return;
          }
          var forced = qs.get('view');
          if (forced === 'desktop' || forced === 'mobile') localStorage.setItem('editor:view', forced);
          var desired = localStorage.getItem('editor:view') || (isMobileDevice() ? 'mobile' : 'desktop');
          if (desired === SELF) return;
          qs.delete('view');
          qs.set('via', 'auto');
          loc.replace(otherOrigin(loc) + loc.pathname + '?' + qs + loc.hash);
        } catch (e) { return; }
      })();
    </script>`;
}

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
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <title>${title}</title>
    <meta name="description" content="${title} · ADC Platform" />
    <meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff" />
    <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#1a202c" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="${title}" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png" />
    <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
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
