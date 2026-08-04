# docs/structure — Plantillas para crear y editar módulos

Estos documentos son el **prompt base** para crear o editar módulos (por humanos o IAs) de forma pragmática y estandarizada. Cada uno define la estructura, plantillas de código y un checklist verificable. Leer el doc de la capa que vas a tocar **antes** de escribir código; seguirlos al pie de la letra; ante un caso no cubierto, imitar los módulos de referencia que cada doc cita.

> Este README es el índice único: al agregar un doc nuevo bajo `docs/structure/`, sumarlo a la tabla de abajo (no hace falta tocar `CLAUDE.md`, que redirige acá).

## Orden de lectura para un servicio backend nuevo

1. [services/models.md](services/models.md) — tipos de dominio y schemas Mongoose.
2. [services/daos.md](services/daos.md) — capa de acceso, autorización y reglas de negocio.
3. [services/endpoints.md](services/endpoints.md) — capa HTTP (adaptadores).
4. [services/service-shell.md](services/service-shell.md) — ensamblaje: `index.ts`, `config.json`, `start()`.

## Según tu tarea

| Tarea                                                   | Documento                                              |
| ------------------------------------------------------- | ------------------------------------------------------ |
| Crear/editar una app empresarial completa (front+back)  | [enterprise-apps.md](enterprise-apps.md)               |
| Índice práctico de servicios (crear y editar/feature)   | [services/README.md](services/README.md)               |
| Editar/extender un servicio o agregar un feature        | [services/README.md](services/README.md)               |
| Crear/modificar entidades persistidas                   | [services/models.md](services/models.md)               |
| Crear/modificar lógica de negocio o permisos            | [services/daos.md](services/daos.md)                   |
| Crear/modificar rutas HTTP                              | [services/endpoints.md](services/endpoints.md)         |
| Armar/editar el `index.ts` y `config.json` del servicio | [services/service-shell.md](services/service-shell.md) |
| Crear/editar una app UI (micro-frontend)                | [apps/frontend.md](apps/frontend.md)                   |
| App UI instalable como PWA                              | [apps/frontend-pwa.md](apps/frontend-pwa.md)           |
| App UI con host mobile dedicado (auto-redirect)         | [apps/frontend-mobile-variant.md](apps/frontend-mobile-variant.md) |
| Estilos Tailwind de un componente federado cross-host   | [apps/frontend-federated-css.md](apps/frontend-federated-css.md) |
| App UI que publica tutoriales (para la app help)        | [apps/frontend-tutorials.md](apps/frontend-tutorials.md) |
| Cuándo un campo queda nativo en vez de usar el átomo    | [apps/frontend-native-controls.md](apps/frontend-native-controls.md) |
| Acceder a otro módulo o a una superficie privilegiada   | [kernel-access.md](kernel-access.md)                   |
| Crear, extraer o instalar un preset (repos git)         | [../multirepo.md](../multirepo.md)                     |

## Autolimpieza de huérfanos (`devCleanup`)

Cualquier módulo (app, service, provider o utility) puede exportar un `devCleanup(opts)` opcional
—declarado en `IModule`— para barrer **sus propios** huérfanos: filas u objetos que quedaron sin
dueño y que ninguna operación normal va a volver a tocar. El kernel lo dispara una vez, apenas el
módulo arranca, en **fire‑and‑forget**: no demora el arranque y si falla sólo deja un warning.

- En desarrollo limpia; en cualquier otro entorno corre con `opts.dryRun` y **sólo reporta** (el
  runner loguea lo devuelto como warning). Borrar datos de producción no es tarea de un hook de arranque.
- Devolvé un `OrphanScan` (`{ scope, found, removed?, detail? }`) por colección revisada; `found: 0`
  no imprime nada.
- Nunca lances por un huérfano suelto: acumulá y seguí. Ante la duda (una consulta que falla) **no borres**.
- Limpiá sólo lo tuyo: si el huérfano lo define el estado de otro módulo, preguntale a su dueño.
  Reusá la cascada de purga que ya tengas en vez de duplicar el borrado.

Referencia: `@common/utils/dev-cleanup.ts` (contrato) y `EmailService.devCleanup` (buzones cuyo
usuario ya no existe, que además bloqueaban el alta por la dirección única).

## Convenciones globales

- Rutas de ejemplo: `src/services/<layer>/<MyService>/` y `src/apps/public/<my-app>/`. Dentro de un preset la estructura interna es idéntica; solo cambia la raíz (`presets/<preset>/services/...`, `presets/<preset>/apps/...`).
- Los tipos compartidos viven en `@common/types/<domain>/`; los errores tipados en `@common/types/custom-errors/`.
- Los helpers reutilizables (escaping, paginación por cursor, crypto, …) viven en `@common/utils/`; no los reimplementes por servicio.
- Cada módulo lleva `README.md` propio (máx 15 líneas) y `config.json` autodocumentado.
- Visión general de la plataforma: [docs/architecture/](../architecture/README.md). En particular,
  para apps UI ver [ui-federation.md](../architecture/ui-federation.md) y para comportamiento runtime
  de servicios/apps (instancias, versionado, deps) ver [app-runtime.md](../architecture/app-runtime.md)
  y [module-system.md](../architecture/module-system.md).
