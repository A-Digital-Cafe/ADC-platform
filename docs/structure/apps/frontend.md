# Apps UI — Plantilla para crear un micro-frontend

Este documento define cómo crear una app UI nueva de la plataforma (React + Module Federation + `adc-ui-library`). Complementa [enterprise-apps.md](../enterprise-apps.md). Para el funcionamiento de Module Federation, namespaces, host-based routing, i18n y service workers, ver [architecture/ui-federation.md](../../architecture/ui-federation.md). Referencia real: `presets/project-management/apps/adc-project-manager/`.

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

- `devPort` único (revisar [../../guides/ports.md](../../guides/ports.md) y los `config.json` existentes).
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

## Layout con sidebar (`adc-sidebar` + `adc-page-shell`)

Apps con navegación lateral (`adc-sidebar`) deben envolver el contenido de **cada página** en
`<adc-page-shell>`. El page-shell aporta el espaciado correcto respecto al sidebar fijo vía su prop
`sidebarOffset` (default `true` → `pl-25 lg:pl-70`) y, opcionalmente, el encabezado de la página
(`heading` / `description` / `headerSpacing`). **No** recrear ese offset a mano con `ml-*`/`pl-*` por
página: usar siempre `adc-page-shell` para que todas las secciones queden alineadas igual.

```tsx
// Vista (page) de una app con sidebar
export default function MiVista() {
	return (
		<adc-page-shell heading={t("seccion.title")} description={t("seccion.subtitle")}>
			{/* contenido de la página */}
		</adc-page-shell>
	);
}
```

- Si la página tiene un header propio (acciones, breadcrumb, toolbar), usar `<adc-page-shell>` sin
  `heading` y mantener el header dentro del slot.
- Páginas públicas/sin sidebar (ej: vista de enlace compartido): `sidebarOffset={false}`.
- Referencia: `presets/my-account` y `presets/adc-drive` (todas las vistas usan `adc-page-shell`).

## Tools de la UI library

Catálogo completo con ejemplos en `00-adc-ui-library/utils/README.md` — reutilizar, no reimplementar.
Los más usados:

- Navegación SPA: `@common/utils/router.js`.
- Sesión/usuario: `@ui-library/utils/session`.
- Fetch (errores + toasts + idempotencia + CSRF): `adc-fetch` (`silent: true` si solo importa el `status`).
- Notificaciones: `toast` de `@ui-library/utils/toast`.
- Llamadas cancelables en React: `useAbortable` (`@ui-library/utils/use-abortable`).
- Logs (en vez de `console.*`): `createUiLogger` (`@ui-library/utils/ui-logger`).
- Inyectar SVG por `innerHTML`: `sanitizeSvg` (`@ui-library/utils/sanitize-svg`), obligatorio.

## Idempotencia en mutaciones (obligatorio)

`EndpointManagerService` **rechaza toda mutación** (`POST`/`PUT`/`PATCH`/`DELETE`) que llegue sin el
header `Idempotency-Key`, devolviendo `400 IDEMPOTENCY_KEY_MISSING` (salvo que el endpoint declare
`skipIdempotency: true`). El síntoma típico es "falta la clave de idempotencia" al guardar/borrar.

Por eso **cada llamada mutativa** del cliente debe pasar una clave por `adc-fetch`:

- `idempotencyData: <obj>` — genera una clave determinista hasheando el objeto (preferido para
  create/update; incluí los campos que distinguen la operación, p. ej. `{ action, id, ...body }`).
- `idempotencyKey: <string>` — clave explícita (útil para `DELETE` por id: `{ idempotencyKey: id }`).

```ts
// PUT/POST/PATCH: hashea los datos de la operación
api.put<Override>("/admin/overrides", { body: input, idempotencyData: input });
api.patch<FileDTO>(`/files/${id}`, { body: patch, idempotencyData: { action: "patch-file", id, ...patch } });

// DELETE por id: el propio id como clave
api.delete(`/admin/overrides/${id}`, { idempotencyKey: id });
```

> La clave dedup vive 2 min (`HTTP_CHECK_TTL_SECONDS`) por `método+url+clave`: repetir la **misma**
> operación dentro de esa ventana responde `409 IDEMPOTENCY_RUNNING`. Usá datos que cambien entre
> operaciones legítimamente distintas (no una constante para acciones repetibles).

## i18n

- Traducciones en `i18n/{locale}.js` con `export default { ... }`; interpolación `{{param}}`.
- Errores de dominio bajo la clave plana `errors.<ERROR_KEY>`. Los genéricos (auth, HTTP, adjuntos, comentarios) ya están en `00-adc-ui-library/i18n/` — no repetirlos.
- Client-side: `t("key")`, `t("key", { param }, "namespace")`, `setLocale()`, `getLocale()`.

## Componentes

- Reutilizar los Web Components de `00-adc-ui-library` (catálogo agrupado + design tokens en su `README.md`).
- Átomos/organismos nuevos y reutilizables se agregan a la UI library, no se duplican en la app.
- Tras crear un componente o icono en la UI library, regenerar las declaraciones JSX (`scripts/generate-react-jsx.mjs`).

### Estilos: design tokens, no colores crudos

Estilá con los tokens del preset Tailwind (`00-adc-ui-library/utils/tailwind-preset.js`), **no** con
hex ni colores nativos de Tailwind: son CSS vars temables (`:root[coffee-theme]` + `[dark-mode]`), así
el tema y el dark mode funcionan solos. Más usados: `text-text` / `text-muted` / `bg-surface` /
`bg-primary` / `bg-accent`; tipografía `font-heading` / `font-text`; `rounded-xxl`, `shadow-cozy`,
`animate-fade-in`. Tonos semánticos (info/success/warn/danger) y acentos de app: consumirlos vía
componentes (`adc-callout`, `adc-badge`, `adc-button`), no como clases sueltas. Catálogo de tokens en
el README de la librería.

### Diálogos y modales: SIEMPRE `adc-modal` (no recrear el modal a mano)

Todo diálogo/modal usa `<adc-modal>` de la UI library. **Nunca** recrear un modal con `fixed`/`absolute
inset-0` + backdrop (`bg-black/…`) + card centrada: rompe la consistencia visual (animaciones, blur,
header, tamaños, foco/scroll) y duplica accesibilidad que el componente ya resuelve. Síntoma del error:
un `<div className="absolute inset-0 z-… flex items-center justify-center bg-black/…">` envolviendo una
card propia.

```tsx
// El contenido va en el slot por defecto; las acciones en slot="footer".
<adc-modal open size="lg" modalTitle="Título" onadcClose={onClose}>
	<div className="flex flex-col gap-4">{/* cuerpo */}</div>
	<div slot="footer" className="flex justify-end gap-2">
		<adc-button variant="accent-outlined" label="Cancelar" onClick={onClose} />
		<adc-button variant="primary" label="Guardar" onClick={onSave} />
	</div>
</adc-modal>
```

- Props: `open`, `modalTitle` (header con ✕), `size` (`sm`|`md`|`lg`|`lg2`|`xl`), `dismissOnBackdrop`,
  `dismissOnEscape`. Emite `adcClose` al cerrar por ✕/backdrop/Escape → enganchar con `onadcClose` (o un
  `ref` + `addEventListener("adcClose", …)`) para sincronizar el estado React.
- Patrón de montaje: render condicional (`{open && <Mi… />}`) con `<adc-modal open …>`, igual que el
  resto de las apps (ver `adc-drive/src/components/*Modal.tsx`, `adc-identity`, `ExportDialog` del editor).
- Confirmaciones/avisos: **no** usar `window.confirm`/`window.alert`/`window.prompt`. Usar `adc-modal`
  (patrón `ConfirmModal` de `adc-drive`) y `toast` de `@ui-library/utils/toast` para notificaciones.

### Controles de formulario: usar los átomos, no `<input>`/`<textarea>`/`<select>` nativos

Estandarizar los campos con los átomos de la UI library en vez de elementos nativos:

| Nativo | Átomo | Binding |
| ------ | ----- | ------- |
| `<input>` texto/número/fecha/password | `adc-input` | `value` + `onInput={(e) => set((e.target as HTMLInputElement).value)}` |
| búsqueda con ícono + debounce | `adc-search-input` | emite `adcInput` (string): `onadcInput={(e) => set(e.detail)}` |
| `<textarea>` | `adc-textarea` | `value` + `onInput` |
| `<input type="checkbox">` | `adc-checkbox` | emite `adcChange` (boolean): `onadcChange={(e) => set(e.detail)}` |
| `<select>` | `adc-select` | `options` (array) + emite `adcChange` (string) |

- `adc-input` soporta `maxLength`, `min`/`max`/`step`, `required`, `readOnly`, `autoFocus` (foca de verdad
  al montar), `inputMode` y `pattern`. Usar **`onInput`** (no `onChange`: en un custom element React lo
  mapea al evento `change` nativo, que sólo dispara al perder foco). El ancho/posición va por `className`
  en el host (el `<input>` interno ya es `w-full`); no se le pasan clases de estilo propio.
- **Quedan nativos a propósito**: file pickers ocultos (`type="file"`); editores especializados (overlays
  de texto posicionados sobre un canvas, editores monospace de archivos); controles inline densos de un
  editor donde el estilo de formulario desentona; `<select>` con **opciones deshabilitadas** (`adc-select`
  no las soporta) o dentro de modales con scroll (su dropdown puede recortarse); y checkboxes que ya
  replican el estilo del átomo (convertirlos no aporta y arriesga regresiones).

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
`@ui-library/utils/markdown-blocks` + `adc-blocks-renderer` (subset markdown soportado: ver
`markdown-blocks` en `utils/README.md`). Una app sin tutoriales simplemente no publica el manifiesto.

## Checklist de creación

- [ ] `config.json` con `uiModule` completo: namespace, `isHost`, `uiDependencies`, `devPort` único, `hosting`.
- [ ] `main.tsx` respeta el orden de imports y no envuelve `<App />` en componentes Stencil.
- [ ] `<adc-layout>` es raíz estable dentro de `App.tsx`.
- [ ] `i18n/{es,en}.js` creados; solo claves de dominio propias (las genéricas vienen de la UI library).
- [ ] Componentes reutilizables agregados a la UI library, no duplicados.
- [ ] Diálogos/modales con `<adc-modal>` (no `inset-0` + backdrop a mano); sin `window.alert/confirm/prompt`.
- [ ] Campos con átomos (`adc-input`/`adc-textarea`/`adc-checkbox`/`adc-select`), no `<input>`/`<textarea>`/`<select>` nativos (salvo las excepciones documentadas).
- [ ] Estilos con design tokens del preset (`text-text`/`bg-surface`/`font-heading`/…), no hex ni colores crudos.
- [ ] App registrada en `adc-home`, `adc-apps-menu` y con icono propio.
- [ ] `serviceWorker` solo si la app es layout.
- [ ] CSP extendida si expone módulos federados cross-app.
- [ ] `README.md` de la app creado (máx 15 líneas).
