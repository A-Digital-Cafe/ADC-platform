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

- `devPort` único (revisar [../../guides/ports.csv](../../guides/ports.csv) y los `config.json` existentes). **Tras crear la app, registrá su puerto en [../../guides/ports.csv](../../guides/ports.csv)** (CSV `port,app,notes` — fuente única que leen el driver de la skill `run-adc-platform` y `bun run cleanup`).
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
`sidebarOffset` (default `true` → `pl-4 lg:pl-70`) y, opcionalmente, el encabezado de la página
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

## PWA / app instalable (opcional)

**Cuándo:** hacé una app instalable **sólo si tiene sentido como app de pantalla de inicio** (Drive, Mail,
My Account, Community, el editor…). **No** instalar: la UI library (no es host), páginas transitorias
(`adc-auth`, `adc-error`), herramientas admin, ni apps que no se usan "sueltas" (p. ej. notificaciones u
`org-requests`). Cada app instalable es **su propio origen** (subdominio), así que la PWA es **por app**.

**Cómo** — todo estático, sin endpoint (todas las apps comparten el namespace `adc-platform`, así que un
endpoint por-namespace serviría **un** manifest compartido; por eso cada app trae el suyo):

1. **`public/manifest.webmanifest`** propio: `id`/`start_url`/`scope` `"/"`, `display: "standalone"`,
   `name`, `short_name`, `theme_color`, `background_color`, `categories`, e `icons` apuntando a
   `/icons/icon-{192,512}.png` (+ variantes `*-maskable`). Se sirve en `/manifest.webmanifest` porque el
   `public/` de la app pisa al default común en `/`.
2. **Tags en el `<head>`** del `index.html`: `<link rel="manifest" href="/manifest.webmanifest">`,
   `theme-color` (con `media` light/dark), `apple-mobile-web-app-*`, `apple-touch-icon`, y `viewport` con
   `viewport-fit=cover`.
3. **Iconos:** el set por defecto (pingüino) vive en `src/common/public/icons/` y se sirve en `/icons/*`
   para todas. Para identidad propia, dropeá tus PNG en el `public/icons/` de la app (mismos nombres →
   pisan al default). Patrón actual: pingüino **oscurecido** de fondo + el SVG `adc-icon-app-<id>` de la UI
   library en el **color representativo** de la app (generación con `sharp`).
4. **`serviceWorker: true`** en el config: Android exige un SW con `fetch` handler para ofrecer instalar.
   El SW (con fallback offline) lo genera `UIFederationService`.
5. El content-type `.webmanifest → application/manifest+json` ya está resuelto en el provider http; el CSP
   ya permite `manifest-src 'self'`.

Referencia: `src/apps/public/adc-home` (launcher instalable) y `presets/adc-drive` (manifest + `public/icons/`
propios). Verificar con `add to home screen` real en Android (criterios: manifest con `name`/`icons` 192+512,
SW con fetch, HTTPS/localhost).

## Variante mobile dedicada · auto-redirect (opcional)

**Cuándo:** sólo si la app necesita un **host aparte** para móvil (otra app con su propio `devPort`/subdominio),
no un layout responsive dentro del mismo host. Caso real: `presets/adc-image-editor` → `adc-image-editor`
(desktop, sub `editor`) y `adc-image-editor-mobile` (sub `m-editor`), que reusa la UI desktop vía un remote
federado (`./MobileEditor`).

**Cómo:** declarás en el `config.json` de **cada** host un bloque `responsive` que apunta a su contraparte;
no hay script en el `index.html`. `UIFederationService` inyecta el redirect en el `<head>` (antes del bundle)
a partir de esa config:

```json
"responsive": {
	"variant": "desktop",                                   // rol de ESTE host
	"counterpart": { "devPort": 3040, "subdomain": "m-editor" } // la OTRA variante
}
```

- El redirect manda a `counterpart` cuando el dispositivo no coincide con `variant` (heurística: UA-Client-Hints
  / UA regex + viewport: puntero coarse + pantalla angosta + retrato). El origen destino se resuelve como el
  resto de la plataforma: en dev/LAN por `devPort`, en prod por `subdomain`.
- El usuario puede forzar/persistir su elección con `?view=desktop|mobile`; el flag `?via=auto` corta loops
  (máx. 1 salto). Conserva ruta + query + hash.
- Es **bidireccional**: el host mobile declara su propio `responsive` (`variant: "mobile"`, counterpart =
  desktop). Ambos hosts necesitan su `devPort` registrado en [../../guides/ports.csv](../../guides/ports.csv).

Lógica única en `UIFederationService` (`utils/codegen/html-templates.ts` → `buildResponsiveRedirectScript`);
tipos en `IUIModule.d.ts` (`UIResponsiveConfig`).

## CSS de un componente federado cross-host (Tailwind)

**Las utilidades de Tailwind son por host.** Cada app genera su CSS escaneando **solo** su propio `src` + el
`src` de sus `uiDependencies` (lo arma `UIFederationService/config-generators/tailwind.ts` con `@source`). La
federación **en runtime** (`lazyLoadRemoteComponent`) **no** está en `uiDependencies`, así que el host consumidor
**no escanea** el `src` del remote: cualquier clase usada **solo** en el componente federado no se genera en el
host que lo renderiza y **falla en silencio** (computa `none`/`auto`). Las clases comunes sobreviven de casualidad
(también están en el `src`/ui-library del host); las únicas/arbitrarias (`max-h-[72dvh]`, `z-[60]`) no.

Hay dos formas de resolverlo, **según el tamaño del componente**:

**1. Componente acotado (modal/panel) → importar el `tailwind.css` de SU app.** Inyecta (via `style-loader`)
todas las utilidades de la app en el host que lo monta. Patrón de `adc-drive` `FolderPicker.tsx` (línea 1).

```tsx
import "../styles/tailwind.css"; // inyecta las utilidades de ESTA app en el host que lo monta
```

Costo: un bundle CSS extra (decenas de KB, una vez al cargar; utilidades idempotentes) — ligero, sin impacto
en render. **⚠️ OJO con componentes full-screen:** importar el `tailwind.css` activa **TODAS** las clases del
componente en el host, incluidas las que **antes estaban dormidas** (no se generaban) y pueden tener valores
inadecuados. Caso real: `MobileEditorScreen` tenía un `max-h-32` en el toolbar que nunca aplicaba; al importar
el CSS, `max-h-32` (128px) empezó a recortar el toolbar → parecía que el lienzo se le encimaba. Si vas por el
import en un layout grande, **auditá** que sus clases den el layout esperado (no asumas que "antes andaba").

**2. Layout full-screen / pocas props críticas → `style` inline.** Inmune a la generación de Tailwind, al
re-escritura de un linter (`z-[60]`→`z-60`) **y** a activar clases latentes. Es lo que usa el bottom-sheet del
editor mobile para `zIndex` (gana al overlay), `maxHeight` y `overscrollBehavior`:

```tsx
<div style={{ zIndex: 60, maxHeight: "72dvh" }} /> // no dependen del CSS por-host
```

Alternativa de fondo: declarar la app productora en el `uiDependencies` del host (suma su `src` al `@source`),
pero acopla el boot y tiene el mismo riesgo de activar clases latentes que el import.

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
- [ ] Puerto registrado en [../../guides/ports.csv](../../guides/ports.csv).
- [ ] `main.tsx` respeta el orden de imports y no envuelve `<App />` en componentes Stencil.
- [ ] `<adc-layout>` es raíz estable dentro de `App.tsx`.
- [ ] `i18n/{es,en}.js` creados; solo claves de dominio propias (las genéricas vienen de la UI library).
- [ ] Componentes reutilizables agregados a la UI library, no duplicados.
- [ ] Diálogos/modales con `<adc-modal>` (no `inset-0` + backdrop a mano); sin `window.alert/confirm/prompt`.
- [ ] Campos con átomos (`adc-input`/`adc-textarea`/`adc-checkbox`/`adc-select`), no `<input>`/`<textarea>`/`<select>` nativos (salvo las excepciones documentadas).
- [ ] Estilos con design tokens del preset (`text-text`/`bg-surface`/`font-heading`/…), no hex ni colores crudos.
- [ ] App registrada en `adc-home`, `adc-apps-menu` y con icono propio.
- [ ] `serviceWorker` solo si la app es layout.
- [ ] (Si instalable) `manifest.webmanifest` + tags PWA en el `<head>` + `serviceWorker: true` + iconos propios en `public/icons/` — ver «PWA / app instalable».
- [ ] (Si tiene host mobile aparte) bloque `responsive` con su `counterpart` en el `config.json` de ambos hosts — ver «Variante mobile dedicada».
- [ ] CSP extendida si expone módulos federados cross-app.
- [ ] `README.md` de la app creado (máx 15 líneas).
