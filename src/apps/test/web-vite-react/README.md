# web-vite-react

App de desarrollo que ejercita la estrategia **`vite-react`** de `UIFederationService`
(bundler vite, no rspack). Ninguna app de producción usa las estrategias `vite-*`, así
que sin esta un bump de vite quedaba sin verificar hasta que alguien las adoptara.

- Host (`isHost: true`): build de `index.html` + dev server / preview de vite.
- Sólo carga con `bun run dev:tests` (`ENABLE_TESTS=true`). Puerto 3007.
- Mantenerla mínima: lo que se prueba es el bundler, no la UI.
