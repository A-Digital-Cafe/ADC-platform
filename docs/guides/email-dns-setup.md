# Configuración DNS para el correo de ADC (adc-mail / email-service)

El correo de la plataforma es **multi-tenant por organización**: cada organización
usa un subdominio del dominio raíz de correo.

- Dominio raíz de correo: `adigitalcafe.com` (`MAIL_ROOT_DOMAIN`).
- Hostname del MTA: `mail.adigitalcafe.com` (`MAIL_HOSTNAME`).
- Direcciones de usuario: `usuario@<orgSlug>.adigitalcafe.com`.

Sustituye dominio, IPs y selector por los tuyos si despliegas otra instancia.

## 0. Estado actual del envío

Mientras `MAIL_INTERNAL_ONLY=true`, el envío está **puenteado por vía interna**:
el `email-service` sólo acepta destinatarios con buzón dentro del dominio de la
plataforma, así que el correo nunca sale a internet. **La recepción desde fuera
no depende de esa variable** y necesita el DNS completo de abajo.

### Desarrollo local sin MTA

En local, el relay apunta a `localhost:25`. Si ahí hay otro MTA (un Postfix del
sistema, por ejemplo) va a rechazar el dominio de la plataforma con un
`550 5.1.1 ... Recipient address rejected`, porque no es un destino suyo.

Para probar el correo sin montar Haraka, poné `MAIL_DEV_LOOPBACK=true`: el
mensaje se genera igual —mismo MIME, mismos adjuntos— pero en vez de salir por
SMTP se inyecta en el buzón destino por la misma vía que usa el webhook
entrante. Sólo aplica a destinatarios internos; si hay alguno externo, el envío
vuelve al relay normal. **Nunca activarla en producción**: se saltea el MTA y con
él DKIM, colas y reintentos. Por eso el default es `false` y hay que optar
explícitamente.

## 1. Registro A / AAAA del MTA ✅

El servidor Haraka necesita un hostname público estable. En Cloudflare, este
registro va **sin proxy** (nube gris): el proxy no reenvía SMTP.

```
mail.adigitalcafe.com.   IN  A     <ip>
```

> ⚠️ `mail.` es **del MTA y de nadie más**. El webmail vive en `email.adigitalcafe.com`, que sí va
> proxeado (o por el túnel). Darle `mail.` a la app la deja inalcanzable —el registro tiene que
> quedar sin proxy para el SMTP, y sin proxy no hay HTTP público que atienda— y en el intento de
> arreglarlo se rompe el correo, que es el error caro de los dos.

## 2. Registros MX ✅

El dominio raíz y un **wildcard** que cubre a todas las organizaciones:

```
adigitalcafe.com.        IN  MX  10  mail.adigitalcafe.com.
*.adigitalcafe.com.      IN  MX  10  mail.adigitalcafe.com.
```

> Sin el wildcard, `usuario@<orgSlug>.adigitalcafe.com` no recibe correo externo.
> Si prefieres no usar wildcard, añade un `MX` por cada `orgSlug` al provisionar
> la organización — pero ojo: crear un nodo explícito `<orgSlug>.adigitalcafe.com`
> bloquea el wildcard para los nombres por debajo de él.

## 3. SPF (autoriza al MTA a enviar) ✅

```
adigitalcafe.com.        IN  TXT  "v=spf1 ip4:<ip> ~all"
*.adigitalcafe.com.      IN  TXT  "v=spf1 ip4:<ip> ~all"
```

## 4. DKIM (un único registro para todo el dominio) ✅

Se usa un **selector global** (`adcmail`) y **una sola clave**. `haraka-plugin-dkim`
resuelve el directorio de claves subiendo por la jerarquía de labels y firma con
`d=` igual al **nombre del directorio encontrado**: con un único directorio
`config/dkim/adigitalcafe.com/`, el correo de `usuario@<org>.adigitalcafe.com`
se firma igual con `d=adigitalcafe.com`. DMARC lo da por alineado gracias a la
alineación relajada (`adkim=r`, el valor por defecto).

```
adcmail._domainkey.adigitalcafe.com.  IN  TXT  "v=DKIM1; k=rsa; p=..."
```

> **No hace falta `*._domainkey`**: un wildcard en `*._domainkey.adigitalcafe.com`
> cubriría otros selectores del dominio raíz, pero **no** los subdominios de
> organización (`adcmail._domainkey.<org>.adigitalcafe.com` no cuelga de
> `_domainkey.adigitalcafe.com`). Firmar con `d=` en la raíz lo resuelve mejor.

Generar el par (la privada queda gitignorada):

```bash
cd src/common/docker/adc-haraka-core/dkim
openssl genrsa -out private 2048 && chmod 600 private
openssl rsa -in private -pubout -out public.pem
# Valor del TXT (una sola línea):
printf 'v=DKIM1; k=rsa; p=%s\n' "$(grep -v '^-----' public.pem | tr -d '\n')"
```

El valor supera los 255 caracteres: en un archivo de zona hay que partirlo en
varias cadenas entrecomilladas (`"…" "…"`); en el panel de Cloudflare se pega
entero y lo divide él.

## 5. DMARC ✅

```
_dmarc.adigitalcafe.com.  IN  TXT  "v=DMARC1; p=none; rua=mailto:dmarc@adigitalcafe.com; fo=1"
```

Empieza en `p=none` para monitorizar y sube a `quarantine` y luego `reject`
cuando los informes salgan limpios.

## 6. PTR (DNS inverso)

Imprescindible para entregabilidad **saliente**. Se configura en el proveedor de
la IP, no en tu zona. Hoy `<tu-ip>` resuelve a una IP residencial cuyo reverse no
controlas, por lo que el envío externo sería rechazado o marcado como spam por
la mayoría de los destinos. Es la razón de peso para mantener
`MAIL_INTERNAL_ONLY=true` hasta mover el MTA a una IP con PTR propio.

## 7. Puertos a abrir en el firewall

| Puerto | Uso                                                          |
| ------ | ------------------------------------------------------------ |
| 25     | SMTP entrante (recepción) y entrega interna del `email-service` |
| 587    | Submission — **hoy cerrado**; se habilita con el envío externo (auth + TLS) |

El `docker-compose.yml` publica sólo el 25 en `127.0.0.1`. Para recibir de fuera
hay que exponer el 25 al exterior (cambiar el binding y redirigir el puerto en
el router/firewall). El 25 **saliente** suele estar bloqueado por el ISP; con
envío interno no molesta.

### STARTTLS (prerequisito para exponer el 25)

El MTA arranca en claro si no hay certificado. Para habilitar STARTTLS, dejar en
`src/common/docker/adc-haraka-core/tls/` (gitignorado) un certificado válido
para `MAIL_HOSTNAME`:

```bash
# Con Let's Encrypt (renombrando al layout que espera el entrypoint):
cp /etc/letsencrypt/live/mail.adigitalcafe.com/fullchain.pem tls/cert.pem
cp /etc/letsencrypt/live/mail.adigitalcafe.com/privkey.pem  tls/key.pem
```

El entrypoint los detecta y activa el plugin `tls` solo; la renovación necesita
reiniciar el contenedor (deploy-hook de certbot). Antes de exponer el puerto,
activar también los límites con Redis comentados en `config/limit.ini`.

## 8. Checklist de verificación

- [x] `dig MX <orgSlug>.adigitalcafe.com` apunta a `mail.adigitalcafe.com`.
- [x] `dig TXT adigitalcafe.com` muestra el SPF.
- [x] `dig TXT adcmail._domainkey.adigitalcafe.com` muestra la clave DKIM.
- [x] `dig TXT _dmarc.adigitalcafe.com` muestra DMARC.
- [ ] `docker logs adc-haraka-core` no muestra el aviso de clave DKIM ausente.
- [ ] Correo interno entre dos buzones de la plataforma llega a la bandeja.
- [ ] Correo desde una cuenta externa llega al buzón (puerto 25 alcanzable).
- [ ] Antes de abrir el envío externo: PTR propio + prueba en mail-tester.com con
      SPF/DKIM/DMARC en verde.
