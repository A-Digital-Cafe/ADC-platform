# comments-utility

Factory de `CommentsManager` con threading, replies, reactions y drafts persistentes (autosave). Cada servicio host
instancia el suyo con `mongoConnection` + `collectionName` (drafts en `${collectionName}_drafts`), `attachmentsManager?`
(valida los `attachmentIds` de `blocks`), `permissionChecker(action, ctx, comment?)` — `action ∈ "list"|"create"|"reply"|"edit"|"delete"|"react"|"moderate"` —
y los topes `maxThreadDepth` / `maxBlocksPerComment` / `editWindowMs`.

## API

- `list(ctx, { targetType, targetId, parentId?, cursor?, limit? })` / `getThread(ctx, threadRootId, opts?)`
- `create(ctx, { targetType, targetId, parentId?, blocks, attachmentIds?, label?, meta? })` / `update(ctx, id, { blocks, attachmentIds? })` / `delete(ctx, id)`
- `react(ctx, id, emoji)` / `unreact(ctx, id, emoji)` — `getById(ctx, id)` / `count(ctx, target)`
- `saveDraft(ctx, key, payload)` / `getDraft(ctx, key)` / `deleteDraft(ctx, key)`
- Frontera de confianza (`kernelKey`, sin checker): `purgeByTarget`, `anonymizeByAuthor` (blanquea autoría y reacciones;
  purga de cuenta) y `listByAuthor(key, userId, limit?)` (export de datos personales: crudo, recientes primero, tope 1000)
