# Content Service

Servicio de gestión de artículos, rutas de aprendizaje, ratings, comentarios y adjuntos. Usa MongoDB + `internal-s3-provider` (minIO) y las utilities `comments-utility` / `attachments-utility`.

## Endpoints (via @RegisterEndpoint)

| Método | Ruta                                                      | Permisos            | Descripción                 |
| ------ | --------------------------------------------------------- | ------------------- | --------------------------- |
| GET    | `/api/learning/paths`                                     | público             | Lista paths                 |
| GET    | `/api/learning/paths/:slug`                               | público             | Obtiene path                |
| POST   | `/api/learning/paths`                                     | content.write       | Crea path                   |
| PUT    | `/api/learning/paths/:slug`                               | content.write       | Actualiza path              |
| DELETE | `/api/learning/paths/:slug`                               | content.delete      | Elimina path                |
| GET    | `/api/learning/articles`                                  | público             | Lista artículos             |
| GET    | `/api/learning/articles/:slug`                            | público             | Obtiene artículo            |
| POST   | `/api/learning/articles`                                  | content.write       | Crea artículo               |
| PUT    | `/api/learning/articles/:slug`                            | content.write       | Actualiza artículo          |
| DELETE | `/api/learning/articles/:slug`                            | content.delete      | Elimina artículo            |
| GET    | `/api/learning/articles/:slug/comments[...]`              | comments checker    | Lista / hilos / drafts      |
| POST   | `/api/learning/articles/:slug/comments`                   | comments checker    | Crea / responde / reacciona |
| PUT    | `/api/learning/articles/:slug/comments/:id`               | comments checker    | Edita comentario            |
| DELETE | `/api/learning/articles/:slug/comments/:id`               | comments checker    | Borra (soft) comentario     |
| GET    | `/api/learning/articles/:slug/attachments[...]`           | attachments checker | Lista / descarga / presign  |
| POST   | `/api/learning/articles/:slug/attachments/presign-upload` | attachments checker | Pre-firma upload S3         |
| DELETE | `/api/learning/articles/:slug/attachments/:attachmentId`  | attachments checker | Borra adjunto               |

Usa `@EnableEndpoints()` y `@DisableEndpoints()` para registro automático via EndpointManagerService.
