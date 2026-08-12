# S3GatewayService

Proxy reverso streaming hacia el object storage interno (Garage, `127.0.0.1:3900`) sobre
un vhost de la plataforma (ej. `s3.adigitalcafe.com`), para exponer las URLs presignadas
al navegador sin nginx. Reenvía host, path, query y headers **verbatim**: la firma SigV4 de la URL
presignada es la única credencial, así que no agrega auth ni reescrituras.

- Deshabilitado por defecto: se activa seteando `S3_GATEWAY_PUBLIC_HOST` (ver `.env.example`).
- Para que las URLs presignadas apunten al gateway: `S3_PUBLIC_ENDPOINT` (raíz), leído por
  `internal-s3-provider` como `publicEndpoint`.
- Streaming en ambas direcciones (motor compartido en `@common/utils/http-proxy.ts` + parser
  passthrough del `fastify-server`): la subida sale por `fetch` con el cuerpo como `ReadableStream`
  —el `ClientRequest` de `node:http` de Bun no emite `drain` y se clavaba pasado ~1 MiB—.
- ⚠️ **La memoria de una subida no está acotada por el motor**: el server HTTP de Bun se traga el
  cuerpo entrante a la velocidad del cliente sin importar cuánto tarde el destino (`socket.pause()`
  no lo frena). Medido con 1 GiB contra un upstream de 100 MB/s: +484 MB de RSS. El pico depende de
  la diferencia de velocidad cliente/Garage, y el techo por request lo pone
  `HTTP_RAW_BODY_LIMIT_BYTES`.
- El relleno de `access-control-allow-origin: *` es propio de acá (las URLs presignadas viajan
  sin cookies), va como hook del motor y no como conducta suya.
- `kernelMode: 90`: registra sus rutas antes del `listen()` de UIFederationService.
