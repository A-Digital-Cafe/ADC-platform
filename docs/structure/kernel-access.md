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

- **Nunca** uses `getMutableRegistry()` ni `getModuleLoader()` en lógica de negocio: son `protected`
  exclusivos de la maquinaria base (cargar/registrar sub‑dependencias declaradas).

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
| `registry:write`, `module:loader` | mutar registry / cargar código | **sólo infra** (nunca un módulo) |

## Checklist al crear/editar un módulo

- [ ] ¿Resuelvo cada dependencia con `getMyService/getMyProvider/getMyUtility` (declarada en `config.json`)
      o `tryGetMyService` (opcional)? No referencio `kernel.registry` ni `Kernel.moduleLoader`.
- [ ] ¿Guardo el token de `start()` sólo en un campo `#privado` y reenvío con `getCapability()`?
- [ ] ¿Mi módulo necesita `orchestrator`/`http:raw`/`storage:register`? → lo declaré en `config.json`.
- [ ] No llamo a `getMutableRegistry()`/`getModuleLoader()` desde lógica de negocio.
