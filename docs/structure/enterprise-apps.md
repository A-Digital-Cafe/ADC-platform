# Apps empresariales (ofimáticas) en ADC Platform

Guía / punto de partida para crear una app de nivel empresarial (correo, docs,
calendario, etc.) sin tener que re-aprender toda la plataforma. Complementa
`docs/structure/services/{endpoints,models,daos}.md`.

## Anatomía de una app empresarial

Una app ofimática típica se compone de **dos presets**:

- `adc-<feature>-frontend` → la app micro-frontend (`apps/adc-<feature>/`).
- `adc-<feature>-backend` → el servicio (`services/<feature>-service/`) + docker.

El backend es un `BaseService` (normalmente `kernelMode` si otros servicios lo
consumen) y el frontend es un host de Module Federation que depende de
`adc-ui-library`.

## Backend: checklist de capacidades

| Necesidad                          | Pieza a usar                                                        | Referencia                        |
| ---------------------------------- | ------------------------------------------------------------------- | --------------------------------- |
| Persistencia                       | `object/mongo` (`createModel`, `useDb`)                             | `IdentityManagerService`          |
| BD propia sobre la conexión de adc | `mongoProvider.useDb(conn, "adc-<feature>")`                        | `IdentityManagerService.forOrg`   |
| Identidad / token                  | `IdentityManagerService.createAuthVerifier()` + `PermissionChecker` | `docs/structure/services/daos.md` |
| Permisos                           | scope nuevo en `@common/types/<feature>/permissions.ts`             | `project-manager/permissions.ts`  |
| Archivos                           | `object/internal-s3-provider` + patrón `AttachmentsManager`         | `attachments-utility`             |
| Trabajos async / escalado          | `queue/rabbitmq` (publish/consumer)                                 | `EndpointManagerService`          |
| Estado transitorio / locks         | `queue/redis` (`set NX`, sorted sets)                               | `OperationsService`               |
| Sagas multi-paso                   | `OperationsService.stepper`                                         | `OperationsService`               |
| Infra (DB, MTA, etc.)              | `docker-compose.yml` en `src/common/docker/adc-*-core/`             | auto-provisión del kernel         |

### Multi-tenant

Dos enfoques (ver `models.md`):

1. **Partición por campo** `orgId` en una BD dedicada (`adc-<feature>`). Simple,
   recomendado para empezar. Indexar `orgId` y usarlo en índices únicos.
2. **Partición por conexión/BD por org** (`forOrg`). Mayor aislamiento, más coste
   operativo.

### Tiers y cuotas

El tier es transversal (`@common/types/tiers.ts` para usuarios,
`OrganizationTier` para orgs). El tier **no viaja en el token**:

- Tier de usuario: `user.metadata.accountTier` (default `free`).
- Tier de org: `org.tier` vía `identity.forOrg(orgId).getOrganization()`.

Define los límites en `@common/types/<feature>/<feature>-tier-limits.ts` como
`Record<Tier, Limits>` con un getter (`getXxxTierLimits(tier)`), igual que
`project-manager/tier-limits.ts`. Aplica el límite **en el DAO**, lanzando un
error tipado `40x` (`QUOTA_EXCEEDED` / `TIER_LIMIT_REACHED`).

### Trabajos programados (scheduled)

No hay scheduler global. Patrón recomendado:

1. Guardar el documento con `scheduledAt: Date` y `status: "scheduled"`.
2. Cron de poll en `service.start()` (`setInterval`) que busca
   `scheduledAt <= now && status === "scheduled"` y publica a RabbitMQ.
3. Si el servicio puede escalar a varias instancias, proteger el tick con un
   lock en Redis (`SET key val NX PX <ttl>`) para evitar doble emisión.

Referencia: cron de soft-delete en `IdentityManagerService` (`scheduledDeletionAt`).

## Frontend: checklist

- `config.json` con `uiModule` (`isHost: true`, `uiDependencies: ["adc-ui-library"]`,
  `devPort`, `hosting.subdomains`, `serviceWorker` solo en apps layout).
- `main.tsx`: importar `@ui-library`, `@ui-library/styles`, luego `./styles/tailwind.css`.
- `App.tsx`: `<adc-layout>` como raíz estable (nunca envolver en `main.tsx`).
- Router y sesión: `@common/utils/router.js`, `@ui-library/utils/session`.
- Reutilizar componentes de `00-adc-ui-library`; añadir nuevos átomos/organismos
  allí si son reutilizables (no duplicar en cada app).

## Errores e i18n

- Las traducciones de errores viven bajo la clave plana `errors.<ERROR_KEY>` en los
  `i18n/{es,en}.js`. El frontend resuelve `errors.${errorKey}` (ver
  `00-adc-ui-library/.../adc-custom-error/error-translator.ts`).
- Genéricos (auth, HTTP, adjuntos, comentarios) ya están en
  `00-adc-ui-library/i18n/` → no repetir en cada app.
- En el backend, errores genéricos van por clases de `@common/types/custom-errors`:
  `AuthorizationError` cubre `NO_TOKEN`/`INVALID_TOKEN`/`FORBIDDEN`. Reservar el `XError` del módulo para claves de dominio.
- Cada app sólo declara en su `errors:` las claves **no genéricas** (de su dominio).
  Si una genérica necesita texto propio, puede repetirse; si además cambia el sentido,
  preferir una clave por recurso (`<RECURSO>_FORBIDDEN`) en vez de pisar la genérica.

## Integración con el resto de la plataforma

- Añadir la app a `adc-home` (`HomePage.tsx` → `MICROAPPS`).
- Añadir al menú de apps (`adc-apps-menu/apps-config.ts` → `DEFAULT_APPS`).
- Crear el icono `adc-icon-app-<id>` en la UI library y regenerar `react-jsx`.

## Enlaces de plataforma (chips `adc-platform-link`) y resolvers

Los enlaces a entidades de otra app (un artículo, un tablero, una tarea…) se
pintan como **chips** estilo Jira / Google Docs: icono de la app + título real de
la entidad. El título lo aporta un **resolver** que cada app expone como _remote_
de Module Federation y que el chip carga **bajo demanda** (aunque esa app nunca
se haya abierto en la sesión).

Mecanismo (en `00-adc-ui-library/utils/platform-links.ts`):

1. **Registro de la app** en `DEFAULT_APPS` con `id`, `label`, `devPort`,
   `subdomain`, `iconTag` (`adc-icon-app-<id>`), `remoteName` (= `name` del
   `config.json` con `-`→`_`) y `resolverExpose` (la clave de `federationExposes`,
   por convención `"./platformLinkResolver"`). Sin `resolverExpose` el chip sólo
   muestra el nombre humanizado de la ruta (sin título enriquecido).
2. **El `config.json` de la app** expone el resolver:
   `"federationExposes": { "./platformLinkResolver": "./src/utils/platform-links-resolver.ts" }`.
   Recuerda incluir en la CSP de la app los orígenes cross-app
   (`script-src`/`connect-src`: `http://localhost:* https://*.adigitalcafe.com`).
3. **El resolver** (`src/utils/platform-links-resolver.ts`) hace **`export default`**
   de un `PlatformLinkResolver`: recibe la ref parseada (`segments`, `query`,
   `hash`) y devuelve `Partial<PlatformLinkInfo>` (`{ title, subtitle? }`),
   `{ status: "denied" | "missing" }`, o `null` (deja el fallback). Es asíncrono
   (puede llamar a su API). Patrón de referencia: `community-home` y
   `presets/project-management/apps/adc-project-manager`.

**Control de acceso (importante):** el permiso se valida **server-side**, no en el
chip. La API de la entidad debe devolver **403** (o 401) cuando el usuario no
puede ver el recurso —p. ej. borradores/privados visibles sólo para su autor o un
rol—; el resolver mapea **401/403 → `denied`** (chip "sin acceso", sin `href`, no
navega) y cualquier otro fallo → `missing`. **Nunca** devuelvas el título de un
recurso restringido: usa `silent: true` en el fetch (`adc-fetch`) para no disparar
toasts y leer sólo `status`. Ejemplo: en community, `GET /articles/:slug` oculta
`listed:false` y `GET /paths/:slug` oculta `public:false` (403) salvo autor / rol
`COMMUNITY.PUBLISH_STATUS.WRITE`.

Para una app **consumidora** no hay nada que hacer: los chips funcionan en
cualquier app que use `adc-inline-tokens` / `adc-platform-link` (UI library).

## Empaquetado en presets

Estructura de un preset (ver `presets/my-account/` y `presets/project-management/`):

```text
presets/adc-<feature>-frontend/
├── LICENCE.md
├── README.md            # máx 15 líneas
└── apps/adc-<feature>/  # la app UI

presets/adc-<feature>-backend/
├── LICENSE.md
├── README.md
├── services/<feature>-service/
└── (docker compose vía src/common/docker/adc-*-core/)
```

Registrar ambos en `presets/.presets.txt`.
