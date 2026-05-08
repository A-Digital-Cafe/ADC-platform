# comments-utility

Factory de `CommentsManager` con soporte de threading, replies, reactions y drafts persistentes (autosave).
Cada servicio host instancia el suyo con:

- `mongoConnection` + `collectionName` (drafts en `${collectionName}_drafts`).
- `attachmentsManager?` (opcional) para validar `attachmentIds` referenciados en `blocks`.
- `permissionChecker(action, ctx, comment?)`: `action ∈ "list"|"create"|"reply"|"edit"|"delete"|"react"|"moderate"`.
- `maxThreadDepth`, `maxBlocksPerComment`, `editWindowMs`, `reactionDocLimit`.

## API

- `list(ctx, { targetType, targetId, parentId?, cursor?, limit? })`
- `getThread(ctx, threadRootId, { cursor?, limit? })`
- `create(ctx, { targetType, targetId, parentId?, blocks, attachmentIds?, label?, meta?, idempotencyKey? })`
- `update(ctx, commentId, { blocks, attachmentIds? })`
- `delete(ctx, commentId)`
- `react(ctx, commentId, emoji)` / `unreact(ctx, commentId, emoji)`
- `saveDraft(ctx, key, payload)` / `getDraft(ctx, key)` / `deleteDraft(ctx, key)`
- `getById(ctx, commentId)` / `count(ctx, target)`
