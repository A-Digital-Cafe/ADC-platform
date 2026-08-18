# Acceso al kernel y capabilities — reglas para módulos

Cómo un módulo (service/app/provider/utility) accede a otros módulos y a superficies privilegiadas
del kernel **sin romper el modelo de seguridad por capabilities**. Léelo antes de tocar `index.ts`,
`start()`, o de llamar a otro servicio. Detalle del diseño: `src/common/security/Capability.ts` y
`src/core/security/capabilityPolicy.ts`.

## Lo que cambió (no uses lo viejo)

- ❌ `kernel.registry` y `Kernel.moduleLoader` **ya no son públicos**. No existen como atributo.
- ✅ El kernel inyecta a cada módulo, al construirlo/iniciarlo, una **capability** propia (token
  infalsificable con un set de _scopes_ acotado a su _tier_). No hay una "master key" compartida que
  los módulos deban manipular.

## Cómo resolver otro módulo (sólo dependencias declaradas)

La **única** forma de resolver otro módulo es declararlo en `config.json` (`providers`/`utilities`/`services`)
y pedirlo con `getMy*`. No hay resolución arbitraria por nombre: si lo necesitás, declaralo.

```ts
const mongo = this.getMyProvider<MongoProvider>("object/mongo");
const identity = this.getMyService<IdentityManagerService>("IdentityManagerService");

// Declarada pero OPCIONAL en runtime (puede no estar cargada): devuelve undefined en vez de tirar.
const email = this.tryGetMyService<EmailService>("EmailService");
```

- El registry **mutable** y el `ModuleLoader` no son alcanzables desde un módulo: viven detrás de
  campos privados de `BaseModule` y sólo los usa su bootstrap, que además consume la infraCap al
  terminar. Si necesitás cargar algo, declaralo en tu `config.json`.

### Resolvé al usar, no guardes la instancia

`getMy*` es un lookup barato (busca la dependencia declarada y la pide al registry). **Llamalo en
cada uso**; no guardes el resultado en un campo. Una instancia guardada en `start()` queda atada a
ese momento: si el kernel recarga ese módulo —editar su archivo en dev, un deploy desde el panel—
te quedás hablándole a una instancia ya detenida, y no se recupera ni recargando tu propio módulo,
sólo reiniciando el kernel.

```ts
// ❌ atado al start(): una recarga del provider lo deja muerto para siempre
const s3 = this.getMyProvider<InternalS3Provider>("object/internal-s3-provider");
this.#manager = createManager({ s3Provider: s3 });

// ✅ getter: cada llamada usa la instancia vigente
this.#manager = createManager({ s3Provider: () => this.getMyProvider<InternalS3Provider>("object/internal-s3-provider") });
```

Si le pasás la dependencia a un colaborador de vida larga (un manager, un DAO), pasale **el getter**,
no la instancia: es el caso donde más duele, porque el colaborador sobrevive a la recarga.
Referencias: `AttachmentsManager` (`S3Resolver`) y `AttachmentsQuotaOptions.getTracker`.

Con `optional: true` esto no es endurecimiento, es lo que hace que "opcional" signifique algo: una
dependencia que no estaba al arrancar **nunca** va a aparecer si la resolviste una sola vez, ni
cuando se lance más tarde desde el modules-manager. Resolvela por llamada y bancate el `undefined`
en cada una (`tryGetMyService`), no sólo la primera.

Lo que **no** arregla: el estado que derivás al arrancar (endpoints registrados, suscripciones,
conexiones abiertas). Eso sigue atado al `start()` y sólo se rehace recargando tu módulo.

### Excepción: ciclos de dependencia

Si declarar la dependencia crearía un ciclo **requerido** (A necesita B y B ya declara A como
requerida), no puede declararse en `config.json`. Patrón sancionado: resolver por nombre fijo con
el **reader** del kernel, de forma perezosa y documentando el ciclo en un comentario. Ejemplo real:
`IdentityManagerService` ↔ `StorageQuotaService` (StorageQuota declara Identity; Identity resuelve
StorageQuota vía `kernel.getReadonlyRegistry().getService(...)` dentro de un getter lazy). Si el
ciclo es con una dependencia **opcional** en un solo sentido, preferí declararla `optional: true`
y `tryGetMyService` (no hace falta el reader).

## Token de ciclo de vida (`start`/`stop`)

`start(token)`/`stop(token)` reciben el token del kernel. Patrón vigente: capturarlo en un campo
**privado** (`#kernelKey`) para reenviarlo a superficies privilegiadas. Reglas:

- Guárdalo sólo en un campo `#privado` (nunca como propiedad pública/legible por nombre).
- Para **llamar a una superficie privilegiada de otro servicio** (p.ej. `identity._internal(...)`),
  reenvía tu capability con `this.getCapability()`. (Hoy esas superficies aún aceptan también la
  `kernelKey` por compatibilidad; la dirección final es `getCapability()`.)

## Privilegios extra: declararlos en `config.json`

Por defecto un módulo recibe sólo los scopes de su _tier_ (abajo). Si necesita más, **decláralo**:

```json
{ "name": "MyService", "privileges": ["http:raw"] }
```

Se validan en runtime y **nunca** conceden scopes de infraestructura. Ejemplos reales:
`adc-modules-manager` → `["orchestrator","http:raw"]`, `SEO` → `["http:raw"]`, servicios que registran
consumo de almacenamiento → `["storage:register"]`.

**Cambiarlos deja rastro.** El kernel anota lo concedido a cada módulo en cada provisión; si una
recarga desde disco (deploy git, watcher de dev, lanzamiento de un pendiente) trae un `config.json`
que pide scopes nuevos, queda un `logWarn`, una entrada `privileges-change` en el audit log del
gestor de módulos y un aviso al equipo de seguridad. Con `MODULES_PRIVILEGE_GATE=true` esos scopes
además **no se conceden** hasta aprobarlos. El módulo arranca igual, sin ellos: el gestor de módulos
los marca en la fila del módulo y se aprueban desde ahí (botón «Aprobar privilegios», que aprueba lo
que el `config.json` declara hoy y reinicia el módulo; API: `POST /api/modules/privileges/approve`).

## Scopes y defaults por tier

Por defecto un módulo sólo recibe `lifecycle` (y las apps, además, `ui:register`). **Todo lo demás es
opt‑in**: se declara en `config.json` → `privileges`.

| Scope | Para qué | Por defecto |
| --- | --- | --- |
| `lifecycle` | `start`/`stop` | todos |
| `ui:register` | registrar módulo UI en UIFederation | apps |
| `identity:internal` | `IdentityManager._internal()` (users/orgs/roles) | opt‑in |
| `identity:avatar` | `IdentityManager._internalAvatar()` (attachments de avatar) | opt‑in |
| `identity:discord` | `IdentityManager._internalDiscord()` (mapeo de roles) | opt‑in |
| `moderation:internal` | `ModerationService._internal()` | opt‑in |
| `orchestrator` | cargar/descargar/deshabilitar módulos | opt‑in |
| `http:raw` | `fastify.getApp()` crudo | opt‑in |
| `storage:register` | registrarse en StorageQuotaService | opt‑in |
| `notifications:broadcast` | `NotificationService.broadcast()` (anuncio a TODOS los usuarios) | opt‑in |
| `audit:write` | `AuditLogService.record/recordStrict()` (audit trail persistente) | opt‑in |
| `registry:write`, `module:loader` | mutar registry / cargar código | **sólo infra** (nunca un módulo) |

## Checklist al crear/editar un módulo

- [ ] ¿Resuelvo cada dependencia con `getMyService/getMyProvider/getMyUtility` (declarada en `config.json`)
      o `tryGetMyService` (opcional)? No referencio `kernel.registry` ni `Kernel.moduleLoader`.
- [ ] ¿Guardo el token de `start()` sólo en un campo `#privado` y reenvío con `getCapability()`?
- [ ] ¿Mi módulo necesita `orchestrator`/`http:raw`/`storage:register`? → lo declaré en `config.json`.
- [ ] No intento alcanzar el registry mutable ni el `ModuleLoader`: no son accesibles desde un módulo
      (`BaseModule` los mantiene privados y consume la infraCap al terminar el bootstrap).
