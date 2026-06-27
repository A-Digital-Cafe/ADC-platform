# UI Framework-Agnostic y Module Federation

Cómo la plataforma sirve micro-frontends: Web Components agnósticos de framework (Stencil), build y
federación con `UIFederationService`, aislamiento por namespaces, routing por host en producción,
i18n y service workers. Para **crear/editar** una app UI, ver
[../structure/apps/frontend.md](../structure/apps/frontend.md); para el overview de capas,
[README.md](README.md).

## Web Components con Stencil

Las UI libraries están construidas con **Stencil** y generan Web Components nativos compatibles con
cualquier framework (React, Vue, Angular, etc.). Hay una librería por namespace:

- **`00-adc-ui-library`** (`src/apps/public/`): librería principal de la plataforma, namespace
  `adc-platform`. Catálogo de componentes y utils en su [README](../../src/apps/public/00-adc-ui-library/).
- **`00-web-ui-library`** y **`00-web-ui-library-mobile`** (`src/apps/test/`): librerías de
  desarrollo para los namespaces `default` y `mobile`.

Características: componentes definidos una vez que funcionan en cualquier framework; sin dependencias
de framework en las apps consumidoras; auto-registro al importar el loader; tipado completo generado.

```typescript
// En cualquier app React/Vue/etc:
import "@ui-library";

// Eventos nativos del DOM directos (click, input, change, …):
<adc-button onClick={handleClick}>Click me</adc-button>

<adc-input inputId="name" value={value} onInput={(e) => setValue(e.target.value)} />
// Los componentes usan shadow: false, así que los eventos burbujean normalmente.
```

## UIFederationService

Gestiona el build y servido de módulos UI:

- Soporta Stencil, React, Vue, Vite y Astro.
- Build automático en desarrollo con watch mode.
- Module Federation con Rspack para apps React/Vue.
- Import maps dinámicos para resolución de módulos.
- Servido estático de componentes compilados.
- **Soporte Multi-UI con Namespaces:** permite usar múltiples librerías UI sin colisiones.

## UI Namespaces

Múltiples conjuntos de UI (librerías, layouts, apps) que no colisionan entre sí. Cada namespace tiene
su propio import map y rutas.

```json
{
	"uiModule": {
		"name": "layout",
		"uiNamespace": "mobile",
		"framework": "react",
		"devPort": 3014
	}
}
```

- Los módulos del mismo namespace comparten la misma UI library.
- Import maps separados por namespace (`/:namespace/importmap.json`).
- Rutas estáticas por namespace (`/:namespace/:moduleName/`).
- El namespace `default` se usa cuando no se especifica.

**Endpoints:** `GET /api/ui/namespaces` (lista namespaces), `GET /:namespace/importmap.json`,
`GET /importmap.json` (namespace default).

## Host-Based Routing (Producción)

En producción (`bun run start` o `bun run start:prodtests`), las apps UI se sirven mediante **virtual
hosts** basados en dominios y subdominios, permitiendo que múltiples apps compartan el mismo puerto.

```json
{
	"uiModule": {
		"name": "layout",
		"hosting": {
			"hosts": [{ "domain": "local.com", "subdomains": ["cloud", "users", "config", "*"] }]
		}
	}
}
```

Formatos de hosting:

```json
// 1) Hosts con subdominios específicos
"hosting": { "hosts": [{ "domain": "example.com", "subdomains": ["app", "admin", "*"] }] }
// 2) Subdominios simples (usa dominio por defecto: local.com)
"hosting": { "subdomains": ["cloud", "users", "*"] }
// 3) Dominios completos
"hosting": { "domains": ["app.example.com", "admin.example.com"] }
```

**Prioridad:** los hosts específicos (`cloud.local.com`) tienen mayor prioridad que los comodines
(`*.local.com`), evitando colisiones cuando varias apps usan comodín.

**Modo Desarrollo vs Producción:**

| Modo              | Comando                   | Provider | Comportamiento                                      |
| ----------------- | ------------------------- | -------- | --------------------------------------------------- |
| Desarrollo        | `bun run dev`             | Express  | Dev servers en puertos separados (3001, 3003, etc.) |
| Producción (test) | `bun run start:prodtests` | Fastify  | Builds compiladas, host-based routing, puerto 3000  |
| Producción        | `bun run start`           | Fastify  | Builds compiladas, host-based routing, puerto 80    |

Los puertos de dev por app están en [../guides/ports.csv](../guides/ports.csv).

**Versiones Mobile:** se distinguen con prefijos o subdominios dedicados:

```json
// web-layout-mobile/config.json
{
	"uiModule": {
		"uiNamespace": "mobile",
		"hosting": {
			"hosts": [
				{ "domain": "local.com", "subdomains": ["m-cloud", "m-users", "m-*"] },
				{ "domain": "m.local.com", "subdomains": ["cloud", "users", "*"] }
			]
		}
	}
}
```

Permite acceder a la versión mobile via `m-cloud.local.com` o `cloud.m.local.com`.

## LangManagerService (i18n)

Servicio en modo kernel para internacionalización compartida entre apps UI. Cada app declara
`"i18n": true` en su `uiModule` y provee traducciones en `i18n/{locale}.js|json` (un namespace por
app, interpolación `{{param}}`, fallback automático de locale). Detalle de endpoints y uso
client-side en [src/services/core/LangManagerService/README.md](../../src/services/core/LangManagerService/README.md).

## Service Worker Dinámico

`UIFederationService` genera automáticamente un service worker cuando `serviceWorker: true`. Habilitar
**solo en layout apps** — cascadea automáticamente a las apps hijas.

```json
{
	"uiModule": { "name": "layout", "serviceWorker": true, "i18n": true }
}
```

Características del SW generado: cache stale-while-revalidate para `/api/i18n/*`; cache-first para
assets estáticos (`.js`, `.css`, imágenes); network-first para el resto; preload de traducciones al
registrar el SW.

## Gotchas de UI (React + Stencil)

1. **UI Library imports:** importar la UI library ANTES de los estilos locales, para asegurar la
   disponibilidad de variables CSS.

   ```typescript
   // main.tsx
   import "@ui-library";          // Auto-registra Web Components
   import "@ui-library/styles";   // CSS base (variables, tipografía, …)
   import "./styles/tailwind.css"; // Extensiones locales (solo Tailwind + extensiones propias)
   ```

2. **Stencil `shadow: false` + swaps de root en React:** los componentes Stencil con `shadow: false`
   (como `adc-layout`, `adc-feature-card`, `adc-skeleton`) reposicionan físicamente los slotted
   children. Nunca renderizar tal componente en `main.tsx` envolviendo `<App />`, y nunca retornar
   nodos JSX top-level diferentes entre renders dentro de ellos — el reconciler de React lanzará
   `NotFoundError: removeChild` al unmount. Colocar `<adc-layout>` dentro de `App.tsx` como root
   estable, o envolver ramas con `key` props distintas para forzar remount completo.

3. **React 19 sincroniza props de custom elements durante el bubbling:** al abrir un popover/menú
   desde un handler de evento React (ej.: `onContextMenu` que setea `open=true` en un web component
   Stencil), React 19 fija la prop síncronamente y el MISMO evento sigue burbujeando. Un listener
   `@Listen("<evento>", { target: "document" })` que cierra "al hacer click/contextmenu afuera" verá
   `open=true` y lo cerrará en el mismo gesto (abre y cierra al instante). Cerrar con un evento
   distinto al de apertura (ej.: abrir en `contextmenu`, cerrar en `mousedown` — que precede al
   `contextmenu`). Ver `adc-context-menu`.
