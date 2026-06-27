# App UI — CSS de un componente federado cross-host (Tailwind)

Extra situacional de [frontend.md](frontend.md). Aplica cuando una app consume **en runtime** un componente
federado de otra app (vía `lazyLoadRemoteComponent`) y sus estilos Tailwind "fallan en silencio".

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
