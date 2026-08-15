# Fastify Server

Servidor HTTP con host-based routing, HTTP/2 y Connect RPC.

## Puertos

- `npm run start` → puerto 80
- `npm run start:prodtests` → puerto 3000

## TLS y HTTP/2

**El TLS lo termina el borde** (Cloudflare o el balanceador) y este puerto queda plano dentro de la
red privada: [docs/guides/tls-edge.md](../../../../docs/guides/tls-edge.md). El protocolo se negocia
en el handshake, antes de saber a qué endpoint va la petición, así que sólo se puede separar por
puerto — que es lo que da un borde.

`ADC_BIND_HOST` ata el puerto a una interfaz (default `0.0.0.0`; en producción real el arranque
avisa si escucha en todas). `HTTP2_ENABLED=true` + `SSL_CERT_PATH`/`SSL_KEY_PATH` sirven TLS acá
adentro: sigue existiendo para un despliegue sin borde, avisa por log, y rompe a los clientes entre
nodos (arman `http://` fijo) y —con h2— al SSE y al túnel. `allowHTTP1` se fuerza siempre que haya
h2, o ALPN negociaría sólo h2 y dejaría afuera a todos los clientes internos.

## Hardening HTTP

- Security headers por defecto. La CSP se **enforcea en producción real** y sale como report-only fuera de ella (`SECURITY_CSP_ENFORCE` fuerza el modo); sin `unsafe-eval` y con `script-src-attr 'none'`. HSTS condicional y protección contra clickjacking/sniffing.
- `script-src` va con **nonce por request** en vez de `'unsafe-inline'` (`security/csp-nonce.ts`): el nonce se ancla a la request y un hook `onSend` —registrado en `listen()` para quedar ÚLTIMO— lo sella sobre cada `<script>` inline del HTML final (import map en disco + lo que inyecten SEOService y modules-manager). Un nonce hace que el navegador ignore `'unsafe-inline'`, así que no conviven: `SECURITY_CSP_SCRIPT_NONCE=false` vuelve al modo anterior.
- `Cross-Origin-Resource-Policy: same-site`, salvo **fuera de producción real** cuando se entra por IP: ahí no hay sitio que comparar y el navegador bloquearía todo subrecurso servido desde otro puerto, así que degrada a `cross-origin`. En producción no degrada nunca, para que pedir por la IP de origen no sea una forma de saltear CORP.
- CSP centralizada: las apps NO duplican la política completa; declaran solo su delta con el header `Content-Security-Policy-Extend` (ej. `"img-src https:; frame-src https://www.youtube.com"`) y el provider lo fusiona sobre la CSP por defecto (que ya distingue dev/prod). `Content-Security-Policy` explícito sigue funcionando como override total.
- `Content-Security-Policy-Restrict` **reemplaza** directivas de la base en vez de sumarles fuentes: es la única forma de *cerrar* un comodín que la base concede por compatibilidad (ej. `img-src https:`, que está ahí porque casi todas las apps muestran avatares remotos). Se aplica después de Extend, así que restringir gana sobre extender la misma directiva. Ej: `"img-src 'self' data: blob: https://cdn.discordapp.com"`.
- CORS: en **producción real** la allowlist es sólo `CORS_ALLOWED_ORIGINS`
  (registrar un vhost no vuelve a ese host un origen de API con credenciales). Fuera de ahí se
  aceptan además los orígenes locales y los vhosts **concretos** — nunca los comodín (`*.dominio`),
  que sirven para ruteo. `isPlatformOrigin()` responde la otra pregunta, "¿este origen es nuestro?",
  y es la que usan el anti-CSRF del túnel de Drive y los headers del SSE hijackeado.
- **IP del cliente**: `TRUSTED_PROXIES` (ver `.env.example`) alimenta el `trustProxy` de fastify;
  vacío = `request.ip` es la IP del socket. `isTrustedProxyPeer()` responde aparte "¿el peer TCP es
  uno de los proxies?", que es lo que habilita a creerle a los headers propios del edge
  (`CF-IPCountry`): `trustProxy` sólo resuelve `request.ip`, no esos headers.
- El ruteo por vhost y la decisión de CORP leen `headers.host` **antes** que `request.hostname`: con
  `trustProxy` activo fastify deriva `hostname` de `X-Forwarded-Host`, que el cliente puede mandar.
- `bodyLimit` se configura con `HTTP_BODY_LIMIT_BYTES`. Los bodies `application/octet-stream` llegan como stream y NO pasan por él: su techo es `HTTP_RAW_BODY_LIMIT_BYTES` (413 al excederlo).
- **Conexiones lentas**: un cuerpo que deja de avanzar `HTTP_IDLE_BODY_TIMEOUT_MS` (30 s) se corta con 408, y cada IP puede tener `HTTP_MAX_INFLIGHT_BODIES_PER_IP` (24) peticiones **con cuerpo** a la vez, contadas en `onRequest` — antes de leer un byte, que es donde el rate limit por endpoint todavía no mira. Sólo cuerpos: un `GET` no cuelga bytes de subida y contarlo mataría el SSE. Ver `security/traffic-shaper.ts` y `security/inflight.ts`; los dos valores viven en `platform_settings`.
- **Caudal de subida**: `UPLOAD_BANDWIDTH_BYTES_PER_SEC` reparte el ancho de banda entrante en partes iguales entre las transferencias en curso y lo achica solo con la carga del proceso (`@common/utils/bandwidth-governor.ts`). Se cambia en caliente desde Admin - Red.
- Los métodos HTTP se limitan a GET, POST, PUT, PATCH, DELETE, HEAD y OPTIONS.

## API Docs (Swagger UI)

`registerApiDocs(getDocument)` monta Swagger UI en `/api/docs` (lo invoca EndpointManagerService; el documento OpenAPI se genera desde los endpoints registrados).

## Connect RPC

APIs REST tipo-seguras con Protocol Buffers. Compatibles con HTTP/1.1 y HTTP/2.

Uso: obtener instancia → `registerConnectRPC()` o `registerConnectService()`.

## Hosting

Configurar en `config.json` de cada app:

```json
"hosting": [{ "domains": ["example.com"], "subdomains": ["*"] }]
```

Para headers específicos por microfrontend usar `uiModule.security.headers`.
