# docs/structure — Plantillas para crear módulos

Estos documentos son el **prompt base** para crear módulos nuevos (por humanos o IAs) de forma pragmática y estandarizada. Cada uno define la estructura, plantillas de código y un checklist verificable. Seguirlos al pie de la letra; ante un caso no cubierto, imitar los módulos de referencia que cada doc cita.

## Orden de lectura para un servicio backend nuevo

1. [services/models.md](services/models.md) — tipos de dominio y schemas Mongoose.
2. [services/daos.md](services/daos.md) — capa de acceso, autorización y reglas de negocio.
3. [services/endpoints.md](services/endpoints.md) — capa HTTP (adaptadores).
4. [services/service-shell.md](services/service-shell.md) — ensamblaje: `index.ts`, `config.json`, `start()`.

## Según tu tarea

| Tarea                                          | Documento                                            |
| ---------------------------------------------- | ---------------------------------------------------- |
| Crear una app empresarial completa (front+back) | [enterprise-apps.md](enterprise-apps.md)             |
| Crear/modificar entidades persistidas          | [services/models.md](services/models.md)             |
| Crear/modificar lógica de negocio o permisos   | [services/daos.md](services/daos.md)                 |
| Crear/modificar rutas HTTP                     | [services/endpoints.md](services/endpoints.md)       |
| Armar el `index.ts` y `config.json` del servicio | [services/service-shell.md](services/service-shell.md) |
| Crear una app UI (micro-frontend)              | [apps/frontend.md](apps/frontend.md)                 |
| Extraer módulos a un repo independiente        | [../multirepo.md](../multirepo.md)                   |

## Convenciones globales

- Rutas de ejemplo: `src/services/<layer>/<MyService>/` y `src/apps/public/<my-app>/`. Dentro de un preset la estructura interna es idéntica; solo cambia la raíz (`presets/<preset>/services/...`, `presets/<preset>/apps/...`).
- Los tipos compartidos viven en `@common/types/<domain>/`; los errores tipados en `@common/types/custom-errors/`.
- Cada módulo lleva `README.md` propio (máx 15 líneas) y `config.json` autodocumentado.
- Visión general de la plataforma: [ARCHITECTURE.md](../../ARCHITECTURE.md).
