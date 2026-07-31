# PlanService

Motor central de **planes, features y límites**, cross apps/services. `kernelMode: 62` (después de Identity, antes de StorageQuota).

- **Catálogo**: cada módulo declara sus features **y sus defaults por tier** con `registerFeatures(cap, defs, defaults)` (scope `plans:register`) al arrancar; el seed de boot sólo aporta la plataforma (`org.seats`, `storage.total`) y los shells por tier. Todo merge es por clave e idempotente; nada pisa un plan editado/importado (`seeded: false`), donde sólo se agregan claves nuevas.
- **Oferta comercial**: los valores del código son **defaults de desarrollo**. La oferta real se define fuera del código y se publica con `PUT /api/plans/admin/plans` (bulk, congela los planes con `seeded: false`). Tras un despliegue nuevo o un `resetPlan`, hay que volver a publicarla.
- **Precio**: `PlanDefinition.price` (unidades menores enteras, `perSeat` en el eje org) es la **única** fuente del precio — lo publica la oferta, lo expone el catálogo público y el módulo de cobro lo lee con `planPrice()`. Sin precio, o en cero, el plan no está a la venta; el código nunca lo siembra y un `resetPlan` lo borra.
- **Tier**: `TierResolver` es el único resolver de la plataforma (usuario → `metadata.accountTier`; org → `org.tier`; admin global → tier máximo). Unifica los cuatro que estaban duplicados.
- **Asientos**: en el eje org los valores escalan `base + perSeat × paidSeats`. `paidSeats` es la feature `org.seats` — comprar asientos es escribir un **override** de la org, no un mecanismo aparte.
- **Overrides**: `plan_overrides` por feature (user/org/role/`org-members-default`), con precedencia user → roles → default por miembro y clamp ≤ valor de la org. Es la **única** colección de excepciones: los `storage_limit_overrides` de `StorageQuotaService` se migran acá en el primer arranque. El listado administrativo pagina (`{ items, total }`, filtro por sujeto) — nunca devuelve la colección entera.
- **Tope por miembro**: `memberFeatures` del plan define cuánto puede usar un miembro sin override propio (generaliza el viejo `ORG_MEMBER_DEFAULT_BYTES`, que sólo existía para bytes).
- **Ampliación**: `org.expansion` es un override booleano que activa los `expansionFeatures` del plan. Se pide con un ticket de tipo `AMPLIACIÓN` y se otorga/revoca desde `PUT /api/plans/admin/orgs/:orgId/expansion` — revocarla no toca la suscripción ni los asientos.
- **Consumo**: `usage_counters`, `_id = "<userId>|<orgId>|<featureKey>|<window>|<period>"`, `$inc` atómico y reset implícito por rotación de período.
- **Endpoints**: `GET /api/plans/me`, `GET /api/plans/catalog` (público) y `/api/plans/admin/*` (`plans.catalog.*` / `plans.overrides.*`).
- **Fail-open**: los consumidores usan `tryGetMyService` + getter lazy y degradan a su matriz local si el servicio no está.
