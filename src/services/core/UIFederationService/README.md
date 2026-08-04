# UIFederationService

Build y servido de módulos UI con Module Federation.

## Frameworks soportados

Stencil, React, Vue, Vite, Astro

## Aliases generados

- `@ui-library` → Auto-registra Web Components
- `@ui-library/styles` → CSS base
- `@ui-library/utils/*` → Utilidades de la UI library

## Orden de carga

1. UI Libraries (Stencil) - paralelo
2. Remotes por dependencias - paralelo por nivel
3. Hosts - al final

Cada watcher espera readiness real (`strategies/shared/readiness.ts`), no un sleep fijo.

## Caché y flags de build

Caché persistente de rspack en `temp/rspack-cache/<ns>/<módulo>` (`ADC_RSPACK_CACHE=false` la
apaga; `POST /api/modules/ui-cache/clear` la vacía). `ADC_NO_UI_SERVERS=true` omite todo build;
`ADC_UI_APPS=a,b` lo acota a esas apps (las UI libraries se compilan siempre). Detalle:
[boot-performance](../../../../docs/architecture/boot-performance.md).

## Seguridad UI

En `config.json` de cada app:

- `uiNamespace` separa import maps, i18n y builds por contexto.
- `uiModule.hosting` registra hosts virtuales en producción.
- `uiModule.security.headers` permite headers/overrides por microfrontend; `Content-Security-Policy` respeta `SECURITY_CSP_ENFORCE`.
- Service worker solo debe activarse en layouts host.
