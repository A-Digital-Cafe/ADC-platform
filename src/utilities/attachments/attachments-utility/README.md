# attachments-utility

Factory de `AttachmentsManager` reutilizable. Cada servicio host instancia su propio manager con:

- `mongoProvider` + `collectionName` propios; `s3Provider` (`internal-s3-provider`) y `bucket`.
- `basePath` por servicio, `subPathResolver(ctx)` y `permissionChecker(action, ctx, attachment?)`.
- `maxSize`, `allowedMimeTypes`, `presignTtl` opcionales.
- `quota: { appId, getTracker }` opcional: release/reconcile descuentan en el contexto (`orgId`) de la subida.
- `encryption: { keyStore }` opcional: **cifrado en reposo por usuario** (envelope AES-256-GCM). En `confirmUpload` el objeto se re-escribe cifrado con la DEK del uploader; la DEK vive envuelta por la KEK `ADC_STORAGE_MASTER_KEY` (32 bytes hex/base64; sin ella se deriva una clave de DEV con warning). `createUserKeyStore({ mongoConnection, collectionName })` crea el almacén de DEKs (compartible con otros artefactos del servicio).

## API del Manager

- `presignUpload(ctx, { fileName, mimeType, size, ownerType, ownerId })` / `confirmUpload(ctx, id)`
- `getDownloadUrl(ctx, id, { ttl?, inline? })` — solo objetos sin cifrar (los cifrados lanzan `ATTACHMENT_ENCRYPTED`)
- `openDownloadStream(ctx, id)` — stream descifrado al vuelo, para proxyear por HTTP (`UncommonResponse.stream`)
- `getById(ctx, id)` / `getMany(ctx, ids[])` / `toDto(att)` / `delete(ctx, id)` / `gc(olderThanMs)`
