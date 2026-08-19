# UI Framework-Agnostic y Module Federation

Cómo la plataforma sirve micro-frontends: Web Components agnósticos de framework (Stencil), build y
federación con `UIFederationService`, aislamiento por namespaces, routing por host en producción,
i18n y service workers. Para **crear/editar** una app UI, ver
[../structure/apps/frontend.md](../structure/apps/frontend.md); para el overview de capas,
[README.md](README.md).

## Web Components con Stencil

Las UI libraries están construidas con **Stencil** y generan Web Components nativos compatibles con
cualquier framework (React, Vue, Angular, etc.). Hay una librería por namespace:

- **`00-adc-ui-library`** (`src/apps/public/`): librería principal de la plataforma, namespace
  `adc-platform`. Catálogo de componentes y utils en su [README](../../src/apps/public/00-adc-ui-library/).
- **`00-web-ui-library`** y **`00-web-ui-library-mobile`** (`src/apps/test/`): librerías de
  desarrollo para los namespaces `default` y `mobile`.

Características: componentes definidos una vez que funcionan en cualquier framework; sin dependencias
de framework en las apps consumidoras; auto-registro al importar el loader; tipado completo generado.

```typescript
// En cualquier app React/Vue/etc:
import "@ui-library";

// Eventos nativos del DOM directos (click, input, change, …):
<adc-button onClick={handleClick}>Click me</adc-button>

<adc-input inputId="name" value={value} onInput={(e) => setValue(e.target.value)} />
// Los componentes usan shadow: false, así que los eventos burbujean normalmente.
```

## UIFederationService

Gestiona el build y servido de módulos UI:

- Soporta Stencil, React, Vue, Vite y Astro.
- Build automático en desarrollo con watch mode.
- Module Federation con Rspack para apps React/Vue.
- Import maps dinámicos para resolución de módulos.
- Servido estático de componentes compilados.
- **Soporte Multi-UI con Namespaces:** permite usar múltiples librerías UI sin colisiones.

## UI Namespaces

Múltiples conjuntos de UI (librerías, layouts, apps) que no colisionan entre sí. Cada namespace tiene
su propio import map y rutas.

```json
{
	"uiModule": {
		"name": "layout",
		"uiNamespace": "mobile",
		"framework": "react",
		"devPort": 3014
	}
}
```

- Los módulos del mismo namespace comparten la misma UI library.
- Import maps separados por namespace (`/:namespace/importmap.json`).
- Rutas estáticas por namespace (`/:namespace/:moduleName/`).
- El namespace `default` se usa cuando no se especifica.

**Endpoints:** `GET /api/ui/namespaces` (lista namespaces), `GET /:namespace/importmap.json`,
`GET /importmap.json` (namespace default).

## Host-Based Routing (Producción)

En producción (`bun run start` o `bun run start:prodtests`), las apps UI se sirven mediante **virtual
hosts** basados en dominios y subdominios, permitiendo que múltiples apps compartan el mismo puerto.

```json
{
	"uiModule": {
		"name": "layout",
		"hosting": {
			"hosts": [{ "domain": "local.com", "subdomains": ["cloud", "users", "config", "*"] }]
		}
	}
}
```

Formatos de hosting:

```json
// 1) Hosts con subdominios específicos
"hosting": { "hosts": [{ "domain": "example.com", "subdomains": ["app", "admin", "*"] }] }
// 2) Subdominios simples (usa dominio por defecto: local.com)
"hosting": { "subdomains": ["cloud", "users", "*"] }
// 3) Dominios completos
"hosting": { "domains": ["app.example.com", "admin.example.com"] }
```

**Prioridad:** los hosts específicos (`cloud.local.com`) tienen mayor prioridad que los comodines
(`*.local.com`), evitando colisiones cuando varias apps usan comodín.

**Modo Desarrollo vs Producción:**

| Modo              | Comando                   | Provider | Comportamiento                                      |
| ----------------- | ------------------------- | -------- | --------------------------------------------------- |
| Desarrollo        | `bun run dev`             | Express  | Dev servers en puertos separados (3001, 3003, etc.) |
| Producción (test) | `bun run start:prodtests` | Fastify  | Builds compiladas, host-based routing, puerto 3000  |
| Producción        | `bun run start`           | Fastify  | Builds compiladas, host-based routing, puerto 80    |

Los puertos de dev por app están en [../guides/ports.csv](../guides/ports.csv).

**Versiones Mobile:** se distinguen con prefijos o subdominios dedicados:

```json
// web-layout-mobile/config.json
{
	"uiModule": {
		"uiNamespace": "mobile",
		"hosting": {
			"hosts": [
				{ "domain": "local.com", "subdomains": ["m-cloud", "m-users", "m-*"] },
				{ "domain": "m.local.com", "subdomains": ["cloud", "users", "*"] }
			]
		}
	}
}
```

Permite acceder a la versión mobile via `m-cloud.local.com` o `cloud.m.local.com`.

## Acceso: roles mínimos por módulo (`uiModule.access`)

Un módulo UI puede exigir sesión y roles **antes de que el kernel entregue un solo byte**. Sin
ellos el navegador recibe un `302` a `error.adigitalcafe.com/unauthorized` y el bundle nunca sale
del servidor: el HTML, el JS y los assets del host quedan detrás del gate.

```json
{
	"uiModule": {
		"access": {
			"globalOnly": true,
			"roles": ["Admin", "App Manager", "Security Manager"]
		}
	}
}
```

- **Semántica `any-of`**: alcanza con UNO de los roles. Es lo que corresponde a un panel que
  varios roles abren con vistas distintas (el gestor de módulos lo usan App Manager y, sólo para
  la auditoría, Security Manager).
- **Por nombre**, sin distinguir mayúsculas ni espacios sobrantes. Valen los de `SystemRole`
  (`@common/types/identity/systemRoles.ts`) y los de cualquier rol propio.
- **`"requireAuth": true`** sin `roles` = cualquier usuario con sesión.
- **`"globalOnly": true`** = módulo de plataforma: no entra nadie con `orgId`. **Hace falta en
  todo panel de plataforma**: cada organización seedea su propio `"Admin"`, así que sin esto el
  admin de una org cualquiera abriría el gestor de módulos por coincidencia de nombre. Es el
  análogo del `globalOnly` de `@common/types/resources.ts`, que impide lo mismo con los permisos.
- Los roles se evalúan **en el contexto** del usuario (personal u organización) con los mismos
  criterios que la resolución de permisos: `IPermissionManager.resolveRoleNames()`, que reusa
  `#contextRoleIds`/`#roleAppliesInContext` para que un rol no pueda conceder permisos sin
  aparecer acá, ni al revés.

**Consecuencias de gatear por nombre**, las dos caras de la misma moneda:

- Un rol propio con exactamente los mismos permisos NO entra si no está en la lista, y renombrar
  un rol deja afuera a quien lo tenga. Cuando se crea un rol que debe abrir un panel, hay que
  agregarlo acá; los endpoints, que autorizan por permiso, no cambian.
- Dos roles distintos pueden llamarse igual en contextos distintos — de ahí `globalOnly`.

**Qué NO cubre** (el gate no reemplaza nada):

- Cada endpoint sigue chequeando sus **permisos**. Esto es una capa de exposición, no de
  autorización: quita el código de la vista pública, no decide qué puede hacer cada quien.
- El chequeo del cliente (`getSession()` + `capsFrom()`) sigue existiendo: decide qué se pinta.
- `/api/*` y `/robots.txt` quedan fuera del gate a propósito: la API autoriza por su cuenta y el
  robots tiene que ser público para poder decir `Disallow`.
- Los **remotes de Module Federation** viven en el host de quien los expone, no en el del
  consumidor: un panel gateado que consume `./ModerationPanel` de `adc-drive` no protege ese chunk.

Mecánica: `UIFederationService` arma el gate en `utils/access-guard.ts` y lo pasa como
`HostOptions.accessGuard` al provider HTTP, que lo corre en `handleStaticRequest` justo antes de
tocar el disco. Toda respuesta que pase por el gate sale `Cache-Control: no-store` (depende de la
cookie del visitante). Es **fail-closed**: sin `SessionManagerService`, o si el gate lanza, no se
sirve. La decisión se cachea **10 s por token** —una carga de página pide decenas de assets— así
que revocar un rol tarda hasta ese lapso en cerrar la PÁGINA; la API corta en el acto.

En desarrollo el kernel no sirve estas apps —cada una corre en su dev server de rspack—, así que
el mismo gate se inyecta como middleware del dev server (`buildDevAccessGate`), que consulta
`GET /api/auth/session` (de ahí sale `user.roles`) y cachea 10 s por cookie.

### Exposes federados (`uiModule.federationAccess`)

Un remote se sirve desde el host de **quien lo expone**, no desde el del consumidor: el panel de
moderación de Drive vive en `drive.adigitalcafe.com` aunque lo pinte `adc-admin-panel`. Gatear el
consumidor no lo protege, y `access` tampoco sirve —cerraría Drive entero—. Para eso está
`federationAccess`, que protege el chunk de un expose puntual dentro de un host público:

```json
{
	"uiModule": {
		"federationAccess": {
			"./ModerationPanel": { "globalOnly": true, "roles": ["Admin", "Security Manager", "Data Manager"] }
		},
		"federationExposes": { "./ModerationPanel": "./src/pages/ModerationAdminView.tsx" }
	}
}
```

Funciona porque cada expose se compila a un chunk con **nombre estable**: el generador de la config
le pasa `name` a Module Federation (`expose_ModerationPanel`), y el servidor protege el prefijo
`/expose_ModerationPanel.` — el `[contenthash]` va detrás y no lo afecta. El nombre lo produce
`@common/utils/federation-exposes.ts`, que es la única fuente para ambos lados: dos copias que se
separen dejarían el chunk sin gate y sin ningún error visible.

Alcance: protege el chunk del expose, no las dependencias compartidas (que no llevan la lógica del
panel), y el `remoteEntry.js` sigue nombrando el expose. Se oculta el código, no su existencia.

## Artefactos de build: qué se publica y con qué caché

El directorio de salida de un módulo se sirve **entero** por HTTP, así que lo que sobra ahí es
código publicado. Tres capas, de la más temprana a la más tardía:

1. **No generarlo.** Los source maps de Stencil llevan `sourcesContent` —el TypeScript original
   completo, incluido el `src/common` que la library arrastra—, así que
   `sourceMap: process.env.NODE_ENV !== 'production'`. Se decide por env y no con un booleano
   horneado porque `stencil.config.ts` queda commiteado y `bun run build:ui` lo reutiliza.
2. **Podarlo.** `prunePublishedArtifacts` borra tras el build de producción lo que no consume
   nadie y Stencil no deja desactivar: `cjs/`, `collection/` (el TS transpilado sin minificar) y
   `types/`. Lo que sí hace falta —`esm/`, `loader/`, el directorio de chunks lazy, `init.js`,
   `index.js`, `styles.css`— no se toca. Resultado medido: la UI library pasó de 12 MB a 1,6 MB.
3. **No servirlo.** `isBlockedBuildArtifact` responde 404 a los `.map` y a esos directorios fuera
   de desarrollo, estén o no en disco: es lo que sobrevive a una library nueva o a un árbol viejo.
   `ADC_SERVE_SOURCEMAPS=true` lo levanta a mano para depurar un incidente.

Los bundles de las apps (rspack) ya salían limpios: `mode: 'production'` minifica y mangla, y
`devtool: false` no emite mapas —requisito de la CSP, que omite `'unsafe-eval'`—.

**Caché.** En producción los nombres llevan `[contenthash:8]`, y `staticCacheControl` deriva la
política del nombre con una sola regla: *lo que puede nombrar a otro archivo revalida; lo que es
una hoja se cachea*.

| Qué | Ejemplo | `Cache-Control` |
| --- | ------- | --------------- |
| Nombre con hash de contenido | `main.a1b2c3d4.js`, `p-048bb303.entry.js` | `max-age=31536000, immutable` |
| Código/manifiesto de nombre fijo | `index.html`, `remoteEntry.js`, `init.js`, `importmap.json` | `no-cache` |
| Hojas | imágenes, fuentes, íconos | `max-age=3600, stale-while-revalidate=86400` |

La fila del medio es la que importa y la que es fácil errar: `remoteEntry.js` **no puede llevar
hash** —los hosts lo referencian por URL— y su contenido cambia en cada despliegue apuntando a
chunks hasheados nuevos. Servir uno viejo no degrada: rompe la carga del remoto entero. Lo mismo
el `init.js`/`loader/index.js` de las UI libraries.

Consecuencia operativa: **un despliegue no necesita purgar la caché del borde**. Los bundles
nuevos vienen con URL nueva (nadie pide los viejos) y los pocos archivos de nombre fijo revalidan
solos. `staticCacheControl` nunca pisa un `Cache-Control` ya puesto, así que el `no-store` del
gate de acceso le gana: un panel protegido no se cachea en ningún lado.

## LangManagerService (i18n)

Servicio en modo kernel para internacionalización compartida entre apps UI. Cada app declara
`"i18n": true` en su `uiModule` y provee traducciones en `i18n/{locale}.js|json` (un namespace por
app, interpolación `{{param}}`, fallback automático de locale). Detalle de endpoints y uso
client-side en [src/services/core/LangManagerService/README.md](../../src/services/core/LangManagerService/README.md).

## Service Worker Dinámico

`UIFederationService` genera automáticamente un service worker cuando `serviceWorker: true`. Habilitar
**solo en layout apps** — cascadea automáticamente a las apps hijas.

```json
{
	"uiModule": { "name": "layout", "serviceWorker": true, "i18n": true }
}
```

Características del SW generado: cache stale-while-revalidate para `/api/i18n/*`; cache-first para
assets estáticos (`.js`, `.css`, imágenes); network-first para el resto; preload de traducciones al
registrar el SW.

## Gotchas de UI (React + Stencil)

1. **UI Library imports:** importar la UI library ANTES de los estilos locales, para asegurar la
   disponibilidad de variables CSS.

   ```typescript
   // main.tsx
   import "@ui-library";          // Auto-registra Web Components
   import "@ui-library/styles";   // CSS base (variables, tipografía, …)
   import "./styles/tailwind.css"; // Extensiones locales (solo Tailwind + extensiones propias)
   ```

2. **Stencil `shadow: false` + swaps de root en React:** los componentes Stencil con `shadow: false`
   (como `adc-layout`, `adc-feature-card`, `adc-skeleton`) reposicionan físicamente los slotted
   children. Nunca renderizar tal componente en `main.tsx` envolviendo `<App />`, y nunca retornar
   nodos JSX top-level diferentes entre renders dentro de ellos — el reconciler de React lanzará
   `NotFoundError: removeChild` al unmount, y con él se desmonta TODO el árbol (pantalla negra).
   Colocar `<adc-layout>` dentro de `App.tsx` como root estable y darle **un único hijo envolvente
   fijo** (`<div className="contents">{render}</div>`): así React siempre muta dentro de ese div y
   nunca borra el nodo que Stencil reubicó. Un `key` distinto por rama NO alcanza — el borrado se
   sigue pidiendo sobre el padre equivocado.

3. **React 19 sincroniza props de custom elements durante el bubbling:** al abrir un popover/menú
   desde un handler de evento React (ej.: `onContextMenu` que setea `open=true` en un web component
   Stencil), React 19 fija la prop síncronamente y el MISMO evento sigue burbujeando. Un listener
   `@Listen("<evento>", { target: "document" })` que cierra "al hacer click/contextmenu afuera" verá
   `open=true` y lo cerrará en el mismo gesto (abre y cierra al instante). Cerrar con un evento
   distinto al de apertura (ej.: abrir en `contextmenu`, cerrar en `mousedown` — que precede al
   `contextmenu`). Ver `adc-context-menu`.
