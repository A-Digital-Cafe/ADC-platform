# ClusterService

Descubrimiento y coordinación entre nodos del kernel. `kernelMode: 40`. Con un solo nodo
funciona igual y no molesta: el registro tiene una entrada y el bus no entrega a nadie.

- **Registro** (Redis, `node:<id>` con TTL): cada nodo publica su entrada y la refresca cada
  10 s. El que se cae desaparece solo — no hay baja que pueda quedar a medias.
- **Bus** (RabbitMQ, exchange `cluster.fanout` efímero): avisos entre procesos vivos
  (invalidar cachés, empujar SSE al nodo que sostiene la conexión). **El emisor no recibe su
  propio eco.** RabbitMQ es opcional: sin él sólo se pierde el fan-out.
- **Afinidad** (`whereIs`/`claim`/`release`): qué nodo sostiene la conexión de un recurso, para
  reenviarle el request en vez de contestar desde uno que no la tiene.
- **Artefactos** (`build-id` de `@common/utils/build-id.ts`, recalculado en cada latido): cada nodo
  publica el suyo y el **primario** publica en `build:current` el vigente para la flota.
- **`GET /healthz`**: sonda del balanceador, sin auth. 503 `starting` mientras arranca y 503
  `stale-build` si a este nodo le falta el `build-id` vigente (eso no pasa solo: hay que
  actualizarlo). Sin drenaje, dos nodos con builds distintos en el mismo vhost dan 404 de chunks.

Identidad y rol salen de `@common/utils/cluster-env.ts`; contrato en
`@common/types/cluster/ICluster.ts`.
