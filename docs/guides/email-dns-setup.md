# Configuración DNS para el correo de ADC (adc-mail / email-service)

El correo de la plataforma es **multi-tenant por organización**: cada organización
usa un subdominio del dominio raíz de correo.

- Dominio raíz de correo: `mail.tudominio.com` (ejemplo; configúralo en el
  `email-service` y en Haraka).
- Direcciones de usuario: `usuario@<orgSlug>.tudominio.com`.

Sustituye `tudominio.com`, las IPs y el selector DKIM por los tuyos reales.

## 1. Registro A / AAAA del MTA

El servidor Haraka necesita un hostname público estable:

```
mail.tudominio.com.      IN  A     203.0.113.10
mail.tudominio.com.      IN  AAAA  2001:db8::10
```

## 2. Registros MX (por subdominio de organización)

Cada subdominio de organización debe enrutar su correo entrante al MTA. Lo más
simple es un **wildcard** que cubre a todas las organizaciones:

```
*.tudominio.com.         IN  MX  10  mail.tudominio.com.
```

> Si prefieres no usar wildcard, añade un `MX` por cada `orgSlug` al provisionar
> la organización (automatizable desde `email-service`).

## 3. SPF (autoriza al MTA a enviar)

Un único registro SPF en el dominio raíz, heredable por los subdominios vía
wildcard TXT:

```
tudominio.com.           IN  TXT  "v=spf1 ip4:203.0.113.10 ip6:2001:db8::10 -all"
*.tudominio.com.         IN  TXT  "v=spf1 ip4:203.0.113.10 ip6:2001:db8::10 -all"
```

## 4. DKIM (selector global)

Usamos un **único selector global** para todo el dominio (decisión de la
plataforma: simplifica la entregabilidad). Haraka firma con una sola clave
privada; publica la clave pública en:

```
adcmail._domainkey.tudominio.com.   IN  TXT  "v=DKIM1; k=rsa; p=MIIBIjANBgkq...<clave pública>"
*._domainkey.tudominio.com.         IN  TXT  "v=DKIM1; k=rsa; p=MIIBIjANBgkq...<clave pública>"
```

- Selector: `adcmail` (debe coincidir con la config de Haraka).
- Genera el par con: `openssl genrsa -out dkim.private.pem 2048` y
  `openssl rsa -in dkim.private.pem -pubout`. Monta la privada en el contenedor
  de Haraka (`src/common/docker/adc-haraka-core/`).

## 5. DMARC

```
_dmarc.tudominio.com.    IN  TXT  "v=DMARC1; p=quarantine; rua=mailto:dmarc@tudominio.com; adkim=r; aspf=r; pct=100"
```

Empieza con `p=none` para monitorizar, sube a `quarantine` y luego `reject`.

## 6. PTR (DNS inverso)

Imprescindible para entregabilidad. Configúralo en tu proveedor de hosting/IP
(no en tu zona DNS): la IP del MTA debe resolver a `mail.tudominio.com`.

```
10.113.0.203.in-addr.arpa.  IN  PTR  mail.tudominio.com.
```

## 7. Puertos a abrir en el firewall

| Puerto | Uso                                                  |
| ------ | ---------------------------------------------------- |
| 25     | SMTP entrante (recepción)                            |
| 587    | Submission (envío autenticado desde `email-service`) |
| 465    | SMTPS (opcional)                                     |

> El puerto 25 saliente suele estar bloqueado por proveedores cloud; solicita su
> apertura o usa un smarthost.

## 8. Checklist de verificación

- [ ] `dig MX <orgSlug>.tudominio.com` apunta a `mail.tudominio.com`.
- [ ] `dig TXT tudominio.com` muestra el SPF.
- [ ] `dig TXT adcmail._domainkey.tudominio.com` muestra la clave DKIM.
- [ ] `dig TXT _dmarc.tudominio.com` muestra DMARC.
- [ ] PTR inverso resuelve al hostname del MTA.
- [ ] Prueba de envío a `check-auth@verifier.port25.com` o mail-tester.com con
      SPF/DKIM/DMARC en verde.
