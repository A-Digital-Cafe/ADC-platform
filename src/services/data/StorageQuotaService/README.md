# StorageQuotaService

Tracking centralizado del uso de almacenamiento (attachments) por **(usuario, contexto)**, cross apps/services. El contexto personal y cada organización llevan contadores separados.

- **Uso**: un doc Mongo por (usuario, contexto) (`storage_usage`, `_id = "<userId>|<orgId>"`) con mapa por app; `commit` es un `updateOne` condicional atómico (mínimo garantizado por app O límite total del contexto). El uso de una org = suma de los docs con su `orgId`.
- **Límites**: los resuelve **`PlanService`** (feature `storage.total`), no este servicio: `LimitsManager` quedó como adaptador a bytes y los overrides viven en `plan_overrides` junto a los del resto de las features. La colección vieja `storage_limit_overrides` se migra sola en el primer arranque. Sin `PlanService`, las lecturas caen a la matriz de `@common/types/tiers/storage.ts` (sin overrides) y la administración responde 503.
- **Mínimos por app**: siguen acá — matriz `STORAGE_APP_MIN_BYTES` por app×contexto×tier, para que una cuota agotada no rompa funcionalidad básica.
- **Integración**: los services registran su app con `registerApp(kernelKey, { appId, label, computeUsage })` y pasan `tracker` a su `AttachmentsManager` (opción `quota`); el mínimo lo resuelve este servicio.
- **Endpoints**: `/api/storage/usage/me`, `/api/storage/apps` (mins del contexto del caller), y `/api/storage/admin/*` incl. `orgs/:orgId/limits` (permisos `storage.usage.*` / `storage.limits.*`).
- **Reconciliación**: `POST /api/storage/admin/reconcile` (o `STORAGE_QUOTA_RECONCILE_MS`) reconstruye contadores por contexto desde `computeUsage` de cada app.
