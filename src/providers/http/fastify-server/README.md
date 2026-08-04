# Fastify Server

Servidor HTTP con host-based routing, HTTP/2 y Connect RPC.

## Puertos

- `npm run start` → puerto 80
- `npm run start:prodtests` → puerto 3000

## HTTP/2

Habilitar con `HTTP2_ENABLED=true`. Requiere certificados SSL:

- `SSL_CERT_PATH`: Ruta al certificado
- `SSL_KEY_PATH`: Ruta a la llave privada
  En desarrollo funciona sin certificados (cleartext, no para producción).

## Hardening HTTP

- Security headers por defecto. La CSP se **enforcea en producción real** y sale como report-only fuera de ella (`SECURITY_CSP_ENFORCE` fuerza el modo); sin `unsafe-eval` y con `script-src-attr 'none'`. HSTS condicional y protección contra clickjacking/sniffing.
- `script-src` va con **nonce por request** en vez de `'unsafe-inline'` (`security/csp-nonce.ts`): el nonce se ancla a la request y un hook `onSend` —registrado en `listen()` para quedar ÚLTIMO— lo sella sobre cada `<script>` inline del HTML final (import map en disco + lo que inyecten SEOService y modules-manager). Un nonce hace que el navegador ignore `'unsafe-inline'`, así que no conviven: `SECURITY_CSP_SCRIPT_NONCE=false` vuelve al modo anterior.
- `Cross-Origin-Resource-Policy: same-site`, salvo **fuera de producción real** cuando se entra por IP: ahí no hay sitio que comparar y el navegador bloquearía todo subrecurso servido desde otro puerto, así que degrada a `cross-origin`. En producción no degrada nunca, para que pedir por la IP de origen no sea una forma de saltear CORP.
- CSP centralizada: las apps NO duplican la política completa; declaran solo su delta con el header `Content-Security-Policy-Extend` (ej. `"img-src https:; frame-src https://www.youtube.com"`) y el provider lo fusiona sobre la CSP por defecto (que ya distingue dev/prod). `Content-Security-Policy` explícito sigue funcionando como override total.
- CORS usa hosts registrados y `CORS_ALLOWED_ORIGINS`/`ADC_CORS_ALLOWED_ORIGINS` para orígenes extra.
- `bodyLimit` se configura con `HTTP_BODY_LIMIT_BYTES`/`ADC_HTTP_BODY_LIMIT_BYTES`. Los bodies `application/octet-stream` llegan como stream y NO pasan por él: su techo es `HTTP_RAW_BODY_LIMIT_BYTES`/`ADC_HTTP_RAW_BODY_LIMIT_BYTES` (413 al excederlo).
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
