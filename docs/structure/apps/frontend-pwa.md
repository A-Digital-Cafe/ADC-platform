# App UI — PWA / app instalable (opcional)

Extra situacional de [frontend.md](frontend.md).

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
