# Help

Centro de ayuda público de Abby's Digital Cafe: tutoriales de la plataforma y base legal/ética
del sitio (GDPR básico, cookies, términos, valores + marco GNI, código de ética, contacto y
roadmap público de cumplimiento).

## Estructura

- `src/pages/`: páginas estáticas versionadas (`/`, `/privacy`, `/cookies`, `/terms`, `/values`,
  `/ethics`, `/hria`, `/authority-requests`, `/transparency`, `/contact`, `/roadmap`) y
  tutoriales (`/tutorials`, `/tutorials/:appId/:slug`).
- `src/components/`: layout interno con sidebar y header.
- `src/data/`: contactos y metadatos compartidos.

Los tutoriales se descubren en runtime: cada microfront publica `public/tutorials/index.json`
+ `.md` en su propio origen y esta app los lista/renderiza vía `@ui-library/utils/tutorials`
y `@ui-library/utils/markdown-blocks` (ver `docs/structure/apps/frontend.md`).
