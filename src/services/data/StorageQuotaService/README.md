# StorageQuotaService

Tracking centralizado del uso de almacenamiento (attachments) por **(usuario, contexto)**, cross apps/services. El contexto personal y cada organización llevan contadores separados.

- **Uso**: un doc Mongo por (usuario, contexto) (`storage_usage`, `_id = "<userId>|<orgId>"`) con mapa por app; `commit` es un `updateOne` condicional atómico (mínimo garantizado por app O límite total del contexto). El uso de una org = suma de los docs con su `orgId`.
- **Límites/mínimos**: matriz central por tier en `@common/types/tiers/storage.ts` (totales, mínimos por app×contexto×tier, default por miembro de org) + overrides en `storage_limit_overrides` (user/org/role/`org-members-default`). Precedencia org: user → roles → default por miembro → límite org (clamp ≤ org también en lectura); `-1` solo en contexto global.
- **Integración**: los services registran su app con `registerApp(kernelKey, { appId, label, computeUsage })` y pasan `tracker` a su `AttachmentsManager` (opción `quota`); el mínimo lo resuelve este servicio.
- **Endpoints**: `/api/storage/usage/me`, `/api/storage/apps` (mins del contexto del caller), y `/api/storage/admin/*` incl. `orgs/:orgId/limits` (permisos `storage.usage.*` / `storage.limits.*`).
- **Reconciliación**: `POST /api/storage/admin/reconcile` (o `STORAGE_QUOTA_RECONCILE_MS`) reconstruye contadores por contexto desde `computeUsage` de cada app.
