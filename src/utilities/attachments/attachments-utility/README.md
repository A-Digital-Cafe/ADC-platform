# attachments-utility

Factory de `AttachmentsManager` reutilizable. Cada servicio host instancia su propio manager con:

- `mongoProvider` + `collectionName` propios.
- `s3Provider` (`internal-s3-provider`) y `bucket`.
- `basePath` constante por servicio (ej. `"projects"`, `"articles"`).
- `subPathResolver(ctx)` para subrutas variables (`<projectId>/<issueId>`, `<slug>`).
- `permissionChecker(action, ctx, attachment?)` callback por servicio.
- `maxSize`, `allowedMimeTypes`, `presignTtl` opcionales.

## API del Manager

- `presignUpload(ctx, { fileName, mimeType, size, ownerType, ownerId })`
- `confirmUpload(ctx, attachmentId)`
- `getDownloadUrl(ctx, id, { ttl?, inline? })`
- `getById(ctx, id)` / `getMany(ctx, ids[])` / `toDto(att)`
- `delete(ctx, id)`
- `gc(olderThanMs)` para limpiar pendings vencidos.
