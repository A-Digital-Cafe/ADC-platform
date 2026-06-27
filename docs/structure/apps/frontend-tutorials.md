# App UI — Tutoriales (opcional)

Extra situacional de [frontend.md](frontend.md). Aplica cuando la app publica tutoriales para que los muestre la app **help**.

Cada microfront publica sus tutoriales como estáticos en `public/tutorials/` (sin federación):

```
public/tutorials/index.json   # { "tutorials": [{ "slug", "title", "description"?, "minutes"? }] }
public/tutorials/<slug>.md    # markdown breve; el título va en el manifiesto, NO como `#` en el .md
```

La app **help** los descubre en runtime sondeando `{origen}/tutorials/index.json` de cada app del
registry de `platform-links` (la app debe estar en `DEFAULT_APPS`) y los renderiza con
`@ui-library/utils/markdown-blocks` + `adc-blocks-renderer` (subset markdown soportado: ver
`markdown-blocks` en `utils/README.md`). Una app sin tutoriales simplemente no publica el manifiesto.
