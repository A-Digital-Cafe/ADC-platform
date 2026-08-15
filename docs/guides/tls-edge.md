# TLS en el borde

**Postura de la plataforma:** el TLS, HTTP/2 y HTTP/3 los habla un **borde** (Cloudflare o un
balanceador), y el puerto del kernel queda **plano dentro de la red privada**.

## Por qué no se declara por endpoint

El protocolo se negocia **antes** de saber a qué endpoint va la petición: TLS en el handshake y
HTTP/2 en el ALPN, sobre un socket que todavía no leyó ni la primera línea. Cuando el servidor sabe
que le pidieron `/api/x`, el protocolo ya está cerrado hace dos viajes. Una tabla «este endpoint va
cifrado» sólo podría **rechazar** lo que llegó por el canal equivocado, no traducirlo — y para eso ya
alcanza con mirar `x-forwarded-proto`.

Lo que sí se puede separar es **por puerto**, y eso es exactamente lo que da un borde: uno público
con TLS y otro privado en claro.

## Qué se rompe si se termina TLS dentro del proceso

No es una preferencia de estilo. Con `SSL_CERT_PATH`/`HTTP2_ENABLED` en este proceso:

| Se rompe | Por qué |
| -------- | ------- |
| Fan-in entre nodos y sus consumidores (logs, recursos, estado, reinicio, apagado), el proxy del gateway, la sonda `/healthz` del panel y la URL de canje del alta | Todos arman `http://` **fijo** a partir de `advertise`, que es `host:puerto` sin esquema. No hay variable para cambiarlo |
| El canje del token de alta y la ingesta de avatares (sólo con certificado autofirmado) | Ningún cliente interno acepta un certificado no confiable |
| El SSE de notificaciones y las rutas crudas del túnel de dispositivos (sólo con HTTP/2) | Bajo h2 no existen las cabeceras de conexión, y esas rutas escriben sobre el socket secuestrado |

Y hay una peor, medida en este runtime: con `HTTP2_ENABLED=true` + certificado, **un cliente que
ofrece sólo HTTP/1.1 no pasa siquiera el handshake TLS** (el servidor corta por falta de protocolo
común en ALPN). El provider pone `allowHTTP1`, que es lo correcto donde se respeta, pero acá no
cambia nada: con h2 en el proceso, ningún cliente interno alcanza al nodo.

Comprobado con un certificado autofirmado y `curl`:

| Configuración | Cliente HTTP/1.1 | Cliente HTTP/2 |
| ------------- | ---------------- | -------------- |
| `SSL_CERT_PATH` sin `HTTP2_ENABLED` | 200 | — |
| `SSL_CERT_PATH` + `HTTP2_ENABLED=true` | **falla el handshake** | 200 |

El arranque avisa por log cada vez que se enciende este camino.

## Configuración

### 1. En el borde

- **TLS**: certificado del borde. Con Cloudflare, modo **Full (strict)** y un **Origin Certificate**
  en el origen si el tramo borde→origen también va cifrado; ese certificado dura 15 años y no hay
  renovación que reiniciar.
- **Cloudflare Tunnel lo resuelve sin certificado de origen**, y es el camino recomendado sin un
  proxy propio delante: `cloudflared` corre en el nodo, abre la conexión **saliente** hacia
  Cloudflare y entrega en `http://127.0.0.1:<puerto>`. El tramo que cruza internet lo cifra el túnel,
  el único tramo plano queda dentro de la máquina, y **no hay puerto publicado** — que es la
  comprobación que más abajo tiene que fallar. `SSL_CERT_PATH`/`SSL_KEY_PATH` y `HTTP2_ENABLED`
  quedan vacías: el puerto sigue plano y los clientes entre nodos lo siguen alcanzando.
- **HTTP/2 y HTTP/3**: se activan ahí y no requieren nada del origen. El origen puede seguir
  hablando HTTP/1.1: el borde traduce.
- **Cabeceras**: que reenvíe `X-Forwarded-For` y `X-Forwarded-Proto`. Cloudflare los manda solo, y
  agrega `CF-IPCountry`, que la plataforma usa para detectar cambio de país en una sesión.

### 2. En el nodo

| Variable | Valor | Para qué |
| -------- | ----- | -------- |
| `TRUSTED_PROXIES` | `cloudflare` (alias ya expandido) o los rangos del balanceador. **Con Cloudflare Tunnel: `loopback`** | Sin esto **toda la gente comparte la IP del borde**: el rate limit los cuenta juntos y un abuso banea a todos. El arranque avisa en producción si está vacío |
| `ADC_BIND_HOST` | la dirección de la red privada, o `127.0.0.1` si el borde corre en la misma máquina (el caso del túnel) | Ata el puerto del kernel a esa interfaz. Default `0.0.0.0` por compatibilidad, y el arranque avisa en producción |
| `HTTP2_ENABLED` | `false` | El borde ya habla h2/h3 |
| `SSL_CERT_PATH` / `SSL_KEY_PATH` | vacías | El TLS no lo termina este proceso |

`ADC_BIND_HOST` no reemplaza al firewall: es la segunda cerradura. **El puerto del kernel no se
publica** — alcanzarlo directo saltea el TLS, el WAF y el rate limit del borde.

Con túnel, `TRUSTED_PROXIES` es la única de estas variables que **cambia de valor en vez de
desaparecer**, y es fácil de errar: quien abre la conexión es el `cloudflared` local, así que el peer
es `127.0.0.1` y los rangos de Cloudflare no matchean con nadie. Con el valor equivocado nada falla
—se registra el loopback como IP de todo el mundo y `CF-IPCountry` se descarta en silencio—, que es
justo el modo en que este tipo de error sobrevive meses.

### 3. Lo que ya funciona solo

Con el borde delante y `TRUSTED_PROXIES` declarado, la plataforma no necesita nada más: `request.ip`
es la IP real del visitante, la cookie de afinidad se marca `Secure`, HSTS sale en producción real
(no depende de que el socket local sea TLS) y el gateway entre nodos sella `x-forwarded-proto` al
reenviar.

## Verificación

```bash
curl -sI https://<dominio>/ | grep -i 'strict-transport\|alt-svc'   # HSTS del borde y HTTP/3 anunciado
curl -s https://<dominio>/healthz                                    # {"status":"ok",…}
curl -s --max-time 5 http://<ip-pública-del-nodo>:<puerto>/healthz    # tiene que FALLAR (sin respuesta)
```

La tercera es la que importa: si contesta, el puerto del kernel está publicado y el borde es
opcional para cualquiera que sepa la IP. Con Cloudflare Tunnel pasa por construcción —no hay puerto
abierto que responder—, y ahí lo que hay que verificar es lo otro: que la IP registrada en un login
sea la del visitante y no `127.0.0.1`, que es el síntoma de `TRUSTED_PROXIES` sin `loopback`.

En los logs del nodo no tiene que haber ninguno de estos avisos: «TLS servido por el propio
proceso», «escucha en TODAS las interfaces» ni «Sin `TRUSTED_PROXIES` en producción».

Red privada entre nodos y alta de una máquina: [network-vpn.md](network-vpn.md).
