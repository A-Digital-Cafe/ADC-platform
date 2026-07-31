# Códigos HTTP de la plataforma

Regla única para el caso que más se equivoca —qué responder cuando "no hay nada"—, aplicable
a cualquier endpoint:

| Situación | Código |
| --------- | ------ |
| Pediste **un recurso concreto** (por id, slug, ruta) y no existe | `404` |
| Pediste una **colección/agregado** y está vacío | `204` |
| Una **mutación no cambió nada** porque el estado pedido ya era el actual | `204` |
| Existe pero **no es accesible ahora** (offline, retenido, expirado, deshabilitado) | `409` / `423` / `410` / `503` |

La pregunta que decide: **¿el cliente nombró lo que falta?** Si nombró un identificador, la
ausencia es un error del pedido → `404`. Si sólo preguntó "qué hay", la ausencia es una
respuesta legítima y vacía → `204`, y el front resuelve con sus defaults (lista vacía,
contador en 0) sin toasts ni ramas de error.

## Cómo se implementa

**Backend** — un handler que devuelve `undefined` o `null` responde `204` sin cuerpo
(automático en [`parts/http.ts`](../../src/services/core/EndpointManagerService/parts/http.ts)):

```ts
@RegisterEndpoint({
	method: "GET",
	url: "/api/things",
	requireAuth: true,
	options: {
		// Los códigos sin cuerpo se documentan sólo con su descripción (no llevan `content`).
		schema: { response: { 200: TS.ListResponse, 204: Type.Null({ description: "Sin resultados" }) } },
	},
})
static async list(ctx: EndpointCtx) {
	const things = await svc.things.list(ctx.user!.id);
	return things.length === 0 ? undefined : { things };
}
```

**Frontend** — `adc-fetch` resuelve un `204/205` como **éxito con `data` indefinido**. Por eso
la condición correcta es `res.success`, nunca la presencia de `res.data`:

```ts
const res = await api.get<{ things: Thing[] }>("", { silent: true });
if (!res.success) return;              // error real (red, 4xx, 5xx)
setThings(res.data?.things ?? []);     // 204 ⇒ vacío, no error
```

> ⚠️ El patrón viejo `if (res.success && res.data)` trata el `204` como fallo silencioso.
> Al pasar un endpoint a `204` hay que revisar **todos** sus consumidores, incluidas las
> sondas de disponibilidad (la campana de notificaciones usaba `res.data` para decidir si
> el `NotificationService` estaba vivo).

## Estado por módulo

**Ya migrado — `adc-notifications`** (la bandeja es del propio usuario: lo que falta nunca
es un error de pedido):

| Endpoint | `204` cuando |
| -------- | ------------ |
| `GET /api/notifications` | la página no trae items (bandeja vacía o fin del cursor) |
| `GET /api/notifications/unread-count` | no hay ninguna sin leer |
| `POST /api/notifications/:id/read` | esa notificación ya no está en la bandeja |
| `DELETE /api/notifications/:id` | ya no estaba (borrado repetido = no-op) |
| `POST /api/notifications/read-all` | no había ninguna sin leer |
| `GET /api/notifications/preferences` | el usuario no fijó ninguna (rigen los defaults) |

**Se quedan en `404` (auditoría del resto de presets y módulos).** Todos los `404` de
`IdentityManagerService`, `SessionManagerService`, `PlanService`, `StorageQuotaService`,
`ModerationService`, `attachments-utility`, `comments-utility`, `adc-drive`,
`adc-email-backend`, `community-content`, `project-management` y `adc-modules-manager`
resuelven un identificador explícito (`:id`, `:slug`, `:folder`, `bannerId`) → son `404`
correctos. Casos que parecen excepción y no lo son:

- `HEAD /api/identity/users/username/:username` — el `404` **es** la señal de "username
  libre" que consume el registro; cambiarlo rompería `adc-auth`/`adc-identity`.
- Redirecciones a S3 (`GET .../avatar`, `GET .../paths/:slug/banner`) — las consume un
  `<img>`: con `204` la imagen queda rota sin disparar el fallback.
- `DELETE` por id (drive, email, comments, issues, sprints): el cliente nombró el recurso,
  así que su ausencia sigue siendo `404`. La bandeja de notificaciones es la excepción
  deliberada, no el patrón general.

**Otros `404` reconvertidos** (la ausencia no era un error del pedido):

| Dónde | Ahora |
| ----- | ----- |
| `POST /api/subscriptions/cancel` sin suscripción activa | `204`: la baja no nombra ningún id y el estado pedido ya es el actual (además idempotente → `skipIdempotency`). |
| Destinatario inexistente al enviar mail (`RECIPIENT_NOT_FOUND`) | `422`: es validación del cuerpo, no un recurso pedido por URL. |
| Montaje de un dispositivo offline (`MOUNT_UNAVAILABLE`) | `409`: el montaje puede existir; su dispositivo no está conectado ahora. |
| Transferencia/zip de descarga vencidos (`TRANSFER_EXPIRED`, `ARCHIVE_EXPIRED`) | `410 Gone`: recursos efímeros por diseño (TTL). |

**Fuera de la regla:** los listados que ya responden `200 { items, total }` con array vacío
(drive, email, project-management, community-content) **no** se migran a `204` en bloque: su
envoltorio transporta `total`/cursor, y perder ese metadato rompe la paginación. `204` sólo
aplica cuando la respuesta vacía no lleva ninguna otra información.

## Resto de códigos

### `201 Created`

`options.successStatus: 201` en los `POST` que **crean** un recurso nuevo (`/api/identity/users`,
`/groups`, `/roles`, `/regions`, `/api/moderation/bans`, `/api/drive/folders`, `/shares`,
`/shortcuts`, `/remotes`, `/tunnel/devices`, `/api/email/drafts`, `/api/learning/articles`,
`/paths`, comentarios, y todo el alta de `project-management`). El schema declarado usa la
misma clave (`response: { 201: ... }`). No aplica a los `POST` que ejecutan una acción
(`/read-all`, `/cancel`, `/confirm`…), que siguen en `200`/`204`.

`adc-fetch` mira `response.ok`, así que los fronts no cambian.

### `202 Accepted`

Ya lo emite `options.enqueue: true` (encola en RabbitMQ y devuelve `jobId` + `pollUrl`):
alta de organizaciones, borrado de roles, `POST /api/drive/archives`, `POST /api/email/inbound`.
El deploy del `modules-manager` (`git/pull`, `rebuild`, `restart`) **sigue síncrono** a
propósito: `enqueue` lo sacaría del host del kernel, que es donde tiene que correr git.

### `206 Partial Content` / `416`

Cualquier `UncommonResponse.stream` honra `Range` automáticamente y anuncia `Accept-Ranges: bytes`
— habilita seek en `<video>`/`<audio>` y descargas reanudables en las descargas de drive
(archivo, enlace público, zip) y en los adjuntos de correo. El parseo vive en
[`@common/utils/byte-range.ts`](../../src/common/utils/byte-range.ts) y lo comparten las dos
puntas: el envío de la respuesta y el **medidor de egress**, que descuenta sólo los bytes del
tramo servido (cobrar el archivo entero en cada salto del reproductor agotaría el cupo mensual
en minutos). Rango fuera del recurso → `416` con `Content-Range: bytes */size`.

### `304 Not Modified`

`options.etag: true` (o `{ ignore: [...] }` para excluir campos que se sellan por request, como
`generatedAt`) calcula un ETag débil del cuerpo y responde `304` vacío ante un `If-None-Match`
que coincide. Activo en `GET /api/modules/status` (semáforo, ~12 KB por poll) y
`GET /api/notifications/unread-count`. Es transparente para el front: el navegador revalida
solo y el JS recibe el cuerpo cacheado.

### Errores

| Código | Cuándo | Ejemplo en el repo |
| ------ | ------ | ------------------ |
| `409` | conflicto de estado: existe pero no en el estado pedido | `ATTACHMENT_PENDING` (sigue subiendo), `MOUNT_UNAVAILABLE`, unicidad |
| `410` | existió y se fue **por diseño** (TTL) | `LINK_EXPIRED`, `TRANSFER_EXPIRED`, `ARCHIVE_EXPIRED` |
| `413` | el pedido excede un tope de tamaño | `ATTACHMENT_TOO_LARGE`, `STORAGE_FULL` |
| `415` | mime no permitido | `ATTACHMENT_UNSUPPORTED_MIME` (lo aplica el avatar vía attachments) |
| `422` | cuerpo bien formado pero imposible por regla de negocio | `SEATS_BELOW_MEMBERS`, `SEATS_OUT_OF_RANGE`, `RECIPIENT_NOT_FOUND` |
| `423` | existe y está completo, pero bloqueado | `ATTACHMENT_RETAINED` (retención legal del borrado en dos etapas) |
| `429` | cuota o rate limit | `EGRESS_QUOTA_EXCEEDED`, `QUOTA_EXCEEDED` |
| `502` | falló un tercero, no la plataforma | `GATEWAY_ERROR` (pasarela de pago) |
| `503` | la plataforma no está lista o el módulo está detenido | `TRANSPORT_UNAVAILABLE`, `DRIVE_UNAVAILABLE`, `GATEWAY_UNAVAILABLE` |

**`Retry-After` no es opcional en `429`/`503`.** Sin él, `adc-fetch` asume 30 s y machaca un
límite que puede durar días. Se declara poniendo `retryAfter` (segundos) en el `data` del error
y [`http.ts`](../../src/services/core/EndpointManagerService/parts/http.ts) lo emite como
cabecera; los `503` reciben 30 s por defecto:

```ts
throw new DriveError(429, "EGRESS_QUOTA_EXCEEDED", "Alcanzaste el cupo mensual", {
	retryAfter: usagePeriodResetsInSeconds("month"), // los períodos de cuota son de calendario UTC
});
```
