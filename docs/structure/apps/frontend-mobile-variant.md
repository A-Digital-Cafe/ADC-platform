# App UI — Variante mobile dedicada · auto-redirect (opcional)

Extra situacional de [frontend.md](frontend.md). Aplica cuando la app necesita un **host aparte** para móvil
(otra app con su propio `devPort`/subdominio), no un layout responsive dentro del mismo host.

**Cuándo:** caso real: `presets/adc-image-editor` → `adc-image-editor` (desktop, sub `editor`) y
`adc-image-editor-mobile` (sub `m-editor`), que reusa la UI desktop vía un remote federado (`./MobileEditor`).

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
