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

- Security headers por defecto, incluyendo CSP report-only, HSTS condicional y protección contra clickjacking/sniffing.
- CSP centralizada: las apps NO duplican la política completa; declaran solo su delta con el header `Content-Security-Policy-Extend` (ej. `"img-src https:; frame-src https://www.youtube.com"`) y el provider lo fusiona sobre la CSP por defecto (que ya distingue dev/prod). `Content-Security-Policy` explícito sigue funcionando como override total.
- CORS usa hosts registrados y `CORS_ALLOWED_ORIGINS`/`ADC_CORS_ALLOWED_ORIGINS` para orígenes extra.
- `bodyLimit` se configura con `HTTP_BODY_LIMIT_BYTES`/`ADC_HTTP_BODY_LIMIT_BYTES`.
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
