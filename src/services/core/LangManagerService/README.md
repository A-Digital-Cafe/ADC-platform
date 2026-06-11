# LangManagerService

Servicio en modo kernel (`kernelMode: 10`) de internacionalización (i18n) compartida entre apps UI.

## Características

- Lee traducciones desde `i18n/{locale}.js|json` de cada app (un namespace por app)
- Soporta locales con región (`es-AR`) y fallback automático a locale base y default
- Interpolación de parámetros con sintaxis `{{param}}`

## Endpoints

- `GET /api/i18n/:namespace?locale=es` — traducciones de un namespace
- `GET /api/i18n?namespaces=a,b&locale=es` — traducciones combinadas

Client-side: las apps con `serviceWorker: true` reciben `t()`, `setLocale()`, `getLocale()` globales.
