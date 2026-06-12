# UI Library Utils

## adc-fetch.ts

Cliente HTTP común para microfrontends. Maneja errores, idempotencia, timeout (30s), retry de red en GET/HEAD y agrega `X-CSRF-Token` automáticamente en POST/PUT/PATCH/DELETE cuando las credenciales no son `omit`. La política de `credentials` es única para toda la plataforma (`DEFAULT_CREDENTIALS`: `include` en dev, `same-origin` en prod) — no hardcodear `include` en los clientes. `assertSafeId()` valida ids interpolados en paths.

## api-identity.ts

Cliente compartido de Identity API (`/api/identity`). Fuente única: las apps re-exportan desde aquí (no duplicar el cliente por app).

## sanitize-svg.ts

`sanitizeSvg(svg)` — allowlist de elementos/atributos SVG (sin `on*`, `<script>`, `foreignObject` ni URIs externas). Obligatorio antes de inyectar iconos por `innerHTML` en componentes.

## ui-logger.ts

`createUiLogger(prefix)` — logger con niveles para apps UI (en prod solo warn/error; `localStorage adc:debug=1` reactiva debug). Usar en lugar de `console.*`.

## use-abortable.ts

`useAbortable(fn)` — hook React para llamadas cancelables (aborta la anterior y al desmontar; los `AbortError` devuelven `undefined`).

## auth-sync.ts

Sincroniza login/logout entre pestañas y expone un logout forzado con recarga para errores globales de sesión. En `localStorage` solo persiste un fingerprint no reversible (`authMarkerFor`), nunca el userId real.

## blocks-clipboard.ts

Portapapeles de bloques ADC en 3 formatos (adc-blocks/HTML/texto) para copiar y pegar. `registerBlocksClipboard(el, opts)` engancha los listeners y devuelve una limpieza.

```typescript
import { registerBlocksClipboard, isEditableTarget } from "@ui-library/utils/blocks-clipboard";

const dispose = registerBlocksClipboard(el, {
	getBlocks: () => currentBlocks, // o null para copiado nativo
	onPaste: (payload, ev) => {
		if (!payload.blocks) return;
		ev.preventDefault();
		insert(payload.blocks); // payload.source: adc-blocks | html | text
		return true;
	},
});
```

## connect-rpc.ts

Cliente Connect RPC tipado usando Protocol Buffers.

```typescript
import { learningClient, type LearningPath } from "@ui-library/utils/connect-rpc";

// Listar paths
const { paths } = await learningClient.listPaths({ listed: true });

// Obtener artículo
const { article } = await learningClient.getArticle({ slug: "mi-articulo" });
```

## platform-links.ts

Detecta a qué microfront apunta una URL (por puerto en dev, subdominio en prod, como `adc-apps-menu`) y resuelve un título legible para la entidad destino. Cada app expone su resolver como **remote de Module Federation** vía `federationExposes` en su `config.json`; el chip `adc-platform-link` lo carga bajo demanda (aunque esa app nunca se haya abierto) y, si falla, degrada al título por defecto.

```jsonc
// config.json de la app destino (ej: community-home)
"federationExposes": {
	"./platformLinkResolver": "./src/utils/platform-links-resolver.ts"
}
```

```typescript
// src/utils/platform-links-resolver.ts → default export
import type { PlatformLinkResolver } from "@ui-library/utils/platform-links";

const resolvePlatformLink: PlatformLinkResolver = async (ref) => {
	const [section, slug] = ref.segments;
	if (section === "articles" && slug) {
		const article = await contentAPI.getArticle(slug);
		return article ? { title: article.title } : { status: "missing" };
	}
	return null; // fallback: ruta legible
};

export default resolvePlatformLink;
```

> La app debe estar listada en `DEFAULT_APPS` (`platform-links.ts`) con su `remoteName` y `resolverExpose`. `registerPlatformLinkResolver(appId, fn)` sigue disponible como _fast-path_ opcional en proceso.

## markdown-blocks.ts

`markdownToBlocks(md)` — convierte markdown (subset: encabezados, listas, checkboxes, código, citas, callouts `> [!tone]`, tablas, divisores) en bloques para `adc-blocks-renderer`. El formato inline lo resuelve `adc-inline-tokens` al renderizar, incluidos los chips `adc-platform-link`.

## tutorials.ts

Descubrimiento y carga de tutoriales de plataforma. Cada microfront publica `public/tutorials/index.json` + `<slug>.md` en su propio origen; `fetchTutorialsCatalog()` sondea todas las apps del registry de `platform-links`, `fetchAppTutorials(app)` trae el manifiesto de una y `fetchTutorialMarkdown(app, slug)` el markdown. Tolerante a apps sin tutoriales (404/fallback SPA → se omiten). Ver `docs/structure/apps/frontend.md`.

## router.ts

Router para navegación SPA sin recargar la página. Ubicado en `@common/utils/router.js`.

```typescript
import { router } from "@common/utils/router.js";

router.navigate("/path");
router.setOnRouteChange((path) => console.log(path));
```
