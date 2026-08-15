# attachments-utility

Factory de `AttachmentsManager` reutilizable. Cada servicio host instancia su propio manager con:

- `mongoProvider` + `collectionName` propios; `s3Provider` (`internal-s3-provider`) y `bucket`.
- `basePath` por servicio, `subPathResolver(ctx)` y `permissionChecker(action, ctx, attachment?)`.
- `maxSize`, `allowedMimeTypes`, `presignTtl` opcionales.
- `quota: { appId, getTracker }` opcional: release/reconcile descuentan en el contexto (`orgId`) de la subida.
- `uploadLimits: { maxConcurrent, bytesPerHour }` opcional: topes de **caudal**, distintos de la cuota
  —la cuota dice cuánto podés tener guardado, esto a qué ritmo llegás a tenerlo—. Sin declararlos, el
  manager toma `UPLOAD_MAX_CONCURRENT` y `UPLOAD_BYTES_PER_HOUR` de la configuración de plataforma
  (así rigen en los seis managers sin cablearlos seis veces). Las subidas en curso se cuentan con los
  `pending` más nuevos que el `presignTtl` —el cupo se libera solo cuando vence la URL— y los bytes se
  suman al confirmar, con el tamaño real, en una colección propia con índice TTL (sumar el `size` de
  los adjuntos sería evadible borrándolos). El rechazo es `429` con `retryAfterSeconds`.
- `encryption: { keyStore }` opcional: **cifrado en reposo por usuario** (envelope AES-256-GCM). En `confirmUpload` el objeto se re-escribe cifrado con la DEK del uploader; la DEK vive envuelta por la KEK `ADC_STORAGE_MASTER_KEY` (32 bytes hex/base64; sin ella se deriva una clave de DEV con warning). `createUserKeyStore({ mongoConnection, collectionName })` crea el almacén de DEKs (compartible con otros artefactos del servicio).

## API del Manager

- `presignUpload(ctx, { fileName, mimeType, size, ownerType, ownerId })` / `confirmUpload(ctx, id)`
- `getDownloadUrl(ctx, id, { ttl?, inline? })` — solo objetos sin cifrar (los cifrados lanzan `ATTACHMENT_ENCRYPTED`)
- `openDownloadStream(ctx, id)` — stream descifrado al vuelo, para proxyear por HTTP (`UncommonResponse.stream`)
- `getById(ctx, id)` / `getMany(ctx, ids[])` / `toDto(att)` / `delete(ctx, id)` / `gc(olderThanMs)`
