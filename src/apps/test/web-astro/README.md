# web-astro

App de desarrollo que ejercita la estrategia **`astro`** (SSG) de `UIFederationService`.
Es la única estrategia que shellea a un binario externo (`astro build`), así que un bump
de astro no lo detecta el typecheck: hay que compilar esta app.

- `AstroStrategy` genera `astro.config.mjs` a partir de `uiModule` (no versionar ese archivo).
- Isla React con `client:load` para cubrir también `@astrojs/react`.
- Sólo carga con `bun run dev:tests` (`ENABLE_TESTS=true`). Puerto 3008.
