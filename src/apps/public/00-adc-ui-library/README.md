# ADC UI Library

Web Components (Stencil, namespace `adc-platform`). Tipos JSX para React autogenerados en
`utils/react-jsx.ts` (regenerar con `scripts/generate-react-jsx.mjs` tras agregar componentes/iconos).

## Uso
```typescript
import "@ui-library";        // Auto-registra los Web Components
import "@ui-library/styles"; // CSS base: variables de tema + tipografía
```

## Componentes
Nombres autoexplicativos; fuente: `src/components/{atoms,molecules,organisms}`.
- **Átomos** (form/UI básicos): `adc-input`, `adc-textarea`, `adc-select`, `adc-combobox`,
  `adc-checkbox`, `adc-toggle`, `adc-slider`, `adc-search-input`, `adc-color-picker`, `adc-button`
  (+ `-rounded`/`-burger`/`-expand`), `adc-badge`, `adc-card`, `adc-callout`, `adc-quote`,
  `adc-divider`, `adc-tabs`, `adc-pagination`, `adc-skeleton`, `adc-star-rating`, `adc-table-block`,
  `adc-code-block`, `adc-text`, `adc-platform-link`, `adc-user-summary`, …
- **Moléculas** (compuestos): `adc-modal`, `adc-page-shell`, `adc-sidebar`, `adc-context-menu`,
  `adc-dropdown-menu`, `adc-apps-menu`, `adc-segmented`, `adc-section-panel`, `adc-content-card` /
  `-feature-card` / `-kanban-card` / `-testimonial-card`, `adc-toast-manager`, `adc-top-breadcrumb`,
  `adc-share-buttons`, `adc-custom-error`, …
- **Organismos** (vistas): `adc-layout`, `adc-site-header`, `adc-site-footer`, `adc-blocks-editor` /
  `-renderer`, `adc-comments-section`, `adc-mail-composer` / `-viewer`.
- **Iconos**: `adc-icon-*` en `src/components/icons`.

## Design tokens (Tailwind)
Definidos en `utils/tailwind-preset.js`; los valores son CSS vars de `src/global/tailwind.css` bajo
`:root[coffee-theme]` (+ variante `[dark-mode]`). **Usar siempre tokens, nunca hex ni colores crudos**
— así el tema y el dark mode funcionan solos.
- **Color** (más usados): `text-text`, `text-muted`, `text-negativeText`, `bg-background`,
  `bg-surface`, `bg-primary`, `bg-accent`. Tonos semánticos (`info`/`success`/`warn`/`danger` + texto
  `t*`) y acentos de app (`accentorange|purple|cyan|red|green`): consumir vía componentes
  (`adc-callout`, `adc-badge`, `adc-button`), no como clases sueltas.
- **Tipografía**: `font-heading` (Fredoka), `font-text` (Inter).
- **Espaciado**: `p-adc-sm|md|lg|xl`. **Radios**: `rounded-xxl`, `rounded-adc`. **Sombra**:
  `shadow-cozy`. **Animaciones**: `animate-fade-in|slide-in|bounce-soft`.

## Utils / tools
Catálogo con ejemplos en [utils/README.md](utils/README.md): `adc-fetch` (HTTP + idempotencia +
CSRF), `session`, `connect-rpc`, `toast`, `markdown-blocks`, `platform-links`, `use-abortable`,
`ui-logger`, `sanitize-svg`, `api-identity`, `tutorials`, `router` (`@common/utils/router.js`).
