# Apps UI — Plantilla para crear un micro-frontend

Este documento define cómo crear una app UI nueva de la plataforma (React + Module Federation + `adc-ui-library`). Complementa `docs/structure/enterprise-apps.md`. Referencia real: `presets/project-management/apps/adc-project-manager/`.

## Estructura completa

```text
src/apps/public/adc-<feature>/        # o presets/<preset>/apps/adc-<feature>/
├── config.json          # uiModule + servicios backend que consume
├── package.json         # Dependencias npm (workspace propio)
├── README.md            # Máx 15 líneas
├── index.html
├── index.ts             # Entry de la app (BaseApp); usualmente mínimo
├── tsconfig.json        # jsx + aliases @ui-library (propio de la app)
├── i18n/
│   ├── en.js
│   └── es.js
└── src/
    ├── main.tsx         # Bootstrap React
    ├── App.tsx          # <adc-layout> raíz estable + router
    ├── ambient.d.ts     # Tipos de módulos federados
    ├── components/
    ├── pages/
    ├── hooks/
    ├── utils/           # platform-links-resolver.ts si expone resolver
    └── styles/tailwind.css
```

## config.json comentado

```json
{
	"uiModule": {
		"name": "adc-my-feature",          // nombre del módulo UI (remote name con - → _)
		"uiNamespace": "adc-platform",     // apps públicas usan adc-platform
		"framework": "react",
		"outputDir": "dist-ui",
		"isHost": true,                    // consume remotes (la UI library)
		"isRemote": false,                 // true solo si expone componentes a otras apps
		"uiDependencies": ["adc-ui-library"], // se cargan antes que esta app
		"devPort": 3018,                   // puerto propio en npm run dev
		"sharedLibs": ["react", "tailwind"],
		"i18n": true,                      // habilita LangManagerService para esta app
		"serviceWorker": false,            // true SOLO en apps layout
		"enableSEO": true,
		"security": {
			"headers": { "Content-Security-Policy-Extend": "img-src https:" }
		},
		"hosting": [
			{ "domains": ["adigitalcafe.com"], "subdomains": ["myfeature"] }
		],
		"federationExposes": {
			"./platformLinkResolver": "./src/utils/platform-links-resolver.ts"
		}
	},
	"services": [
		{ "name": "MyFeatureService", "version": "latest" },
		{ "name": "IdentityManagerService", "version": "latest" }
	]
}
```

Reglas:

- `devPort` único (revisar `docs/puertos.md` y los `config.json` existentes).
- `hosting` define los subdominios de producción; en dev cada app usa su `devPort`.
- `serviceWorker: true` solo en apps layout: cascadea automáticamente a sus hijas.
- Si la app expone `federationExposes` consumidos cross-app (ej. el resolver de platform links), extender la CSP con los orígenes cross-app (`script-src`/`connect-src`: `http://localhost:* https://*.adigitalcafe.com`).

## main.tsx

El orden de imports es obligatorio (UI library antes que estilos locales):

```tsx
import "@ui-library/utils/react-jsx";
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "@ui-library";          // Auto-registra Web Components
import "@ui-library/styles";   // CSS base (variables, tipografía)
import "./styles/tailwind.css"; // Solo Tailwind + extensiones propias

const container = document.getElementById("root");
if (container) {
	createRoot(container).render(
		<React.StrictMode>
			<App />
		</React.StrictMode>
	);
}
```

- **Nunca** envolver `<App />` con componentes Stencil `shadow: false` (como `adc-layout`) en `main.tsx`: rompen el reconciler de React (`NotFoundError: removeChild`).
- `<adc-layout>` va **dentro de `App.tsx`** como raíz estable que no cambia entre renders.

## Router y sesión

- Navegación SPA: `@common/utils/router.js`.
- Sesión/usuario: `@ui-library/utils/session`.
- Fetch con manejo de errores y toasts: `adc-fetch` de la UI library (usar `silent: true` cuando solo importa el `status`).

## i18n

- Traducciones en `i18n/{locale}.js` con `export default { ... }`; interpolación `{{param}}`.
- Errores de dominio bajo la clave plana `errors.<ERROR_KEY>`. Los genéricos (auth, HTTP, adjuntos, comentarios) ya están en `00-adc-ui-library/i18n/` — no repetirlos.
- Client-side: `t("key")`, `t("key", { param }, "namespace")`, `setLocale()`, `getLocale()`.

## Componentes

- Reutilizar los Web Components de `00-adc-ui-library` (catálogo en su `README.md`).
- Átomos/organismos nuevos y reutilizables se agregan a la UI library, no se duplican en la app.
- Tras crear un componente o icono en la UI library, regenerar las declaraciones JSX (`scripts/generate-react-jsx.mjs`).

## Integración con la plataforma

1. Agregar la app a `adc-home` (`HomePage.tsx` → `MICROAPPS`).
2. Agregar al menú de apps (`adc-apps-menu/apps-config.ts` → `DEFAULT_APPS`), incluyendo `remoteName` y `resolverExpose` si expone resolver.
3. Crear el icono `adc-icon-app-<id>` en la UI library y regenerar `react-jsx`.
4. (Opcional) Exponer `./platformLinkResolver` para chips de enlaces cross-app — ver `docs/structure/enterprise-apps.md`.

## Tutoriales

Cada microfront publica sus tutoriales como estáticos en `public/tutorials/` (sin federación):

```
public/tutorials/index.json   # { "tutorials": [{ "slug", "title", "description"?, "minutes"? }] }
public/tutorials/<slug>.md    # markdown breve; el título va en el manifiesto, NO como `#` en el .md
```

La app **help** los descubre en runtime sondeando `{origen}/tutorials/index.json` de cada app del
registry de `platform-links` (la app debe estar en `DEFAULT_APPS`) y los renderiza con
`@ui-library/utils/markdown-blocks` + `adc-blocks-renderer`. Subset markdown soportado: encabezados,
listas, checkboxes, código cercado, citas, callouts (`> [!info]`), tablas, divisores e inline
(`**`, `*`, `` ` ``, links — incluidos chips de plataforma). Una app sin tutoriales simplemente no
publica el manifiesto.

## Checklist de creación

- [ ] `config.json` con `uiModule` completo: namespace, `isHost`, `uiDependencies`, `devPort` único, `hosting`.
- [ ] `main.tsx` respeta el orden de imports y no envuelve `<App />` en componentes Stencil.
- [ ] `<adc-layout>` es raíz estable dentro de `App.tsx`.
- [ ] `i18n/{es,en}.js` creados; solo claves de dominio propias (las genéricas vienen de la UI library).
- [ ] Componentes reutilizables agregados a la UI library, no duplicados.
- [ ] App registrada en `adc-home`, `adc-apps-menu` y con icono propio.
- [ ] `serviceWorker` solo si la app es layout.
- [ ] CSP extendida si expone módulos federados cross-app.
- [ ] `README.md` de la app creado (máx 15 líneas).
