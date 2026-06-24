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
| Crear, extraer o instalar un preset (repos git)         | [../multirepo.md](../multirepo.md)                     |

## Convenciones globales

- Rutas de ejemplo: `src/services/<layer>/<MyService>/` y `src/apps/public/<my-app>/`. Dentro de un preset la estructura interna es idéntica; solo cambia la raíz (`presets/<preset>/services/...`, `presets/<preset>/apps/...`).
- Los tipos compartidos viven en `@common/types/<domain>/`; los errores tipados en `@common/types/custom-errors/`.
- Los helpers reutilizables (escaping, paginación por cursor, crypto, …) viven en `@common/utils/`; no los reimplementes por servicio.
- Cada módulo lleva `README.md` propio (máx 15 líneas) y `config.json` autodocumentado.
- Visión general de la plataforma: [docs/architecture/](../architecture/README.md). En particular,
  para apps UI ver [ui-federation.md](../architecture/ui-federation.md) y para comportamiento runtime
  de servicios/apps (instancias, versionado, deps) ver [app-runtime.md](../architecture/app-runtime.md)
  y [module-system.md](../architecture/module-system.md).
