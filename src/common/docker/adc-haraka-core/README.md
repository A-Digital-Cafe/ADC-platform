# adc-haraka-core

MTA self-hosted (Haraka) para la plataforma de correo ADC. Auto-provisionado por el
kernel si está junto a un módulo, o levantable con `docker compose up -d`.

- Puerto **25**: SMTP entrante (recepción de correo de otros servidores).
- Puerto **587**: submission autenticado (envío desde `email-service`).
- Entrega entrante al `email-service` vía webhook firmado (`adc_inbound_webhook`).
- Firmado **DKIM** saliente con selector global (`adcmail`).
- Reglas **antispam** básicas (`adc_basic_spam`) que anotan `X-ADC-Spam-Score`.

DNS necesario: registro `A`/`PTR` para `mail.tudominio.com`, wildcard `MX` y `TXT` SPF en `*.tudominio.com`,
DKIM en `adcmail._domainkey.tudominio.com` (y wildcard `*._domainkey`) y `_dmarc` TXT. Genera la clave DKIM
con `openssl genrsa -out dkim.private.pem 2048`; monta la privada en `./dkim/<dominio>/private`.
Variables clave: `MAIL_HOSTNAME`, `MAIL_ROOT_DOMAIN`, `MAIL_INBOUND_WEBHOOK_URL`, `MAIL_INBOUND_WEBHOOK_SECRET`, `MAIL_DKIM_SELECTOR`.
