# adc-haraka-core

MTA self-hosted (Haraka) para la plataforma de correo ADC. Auto-provisionado por el
kernel si está junto a un módulo, o levantable con `docker compose up -d`.

- Puerto **25**: SMTP entrante (recepción de correo de otros servidores).
- Puerto **587**: submission (envío desde `email-service`).
- Entrega entrante al `email-service` vía webhook firmado (`adc_inbound_webhook`).
- **DKIM** (`haraka-plugin-dkim`): firma el saliente y verifica el entrante.
- Reglas **antispam** básicas (`adc_basic_spam`) que anotan `X-ADC-Spam-Score`.
- Destinatarios aceptados: dominio raíz (`host_list`) y subdominios de organización
  (`host_list_regex`, porque `in_host_list` compara por igualdad exacta).

La clave DKIM va en `./dkim/private` (gitignorada; `openssl genrsa -out dkim/private 2048`);
el entrypoint la copia a `config/dkim/<raíz>/` y se firma con `d=<raíz>`, así que **un solo**
TXT `adcmail._domainkey.<raíz>` cubre todos los subdominios (DMARC alinea en modo relajado).
DNS completo en [docs/guides/email-dns-setup.md](../../../../docs/guides/email-dns-setup.md).
Variables: `MAIL_HOSTNAME`, `MAIL_ROOT_DOMAIN`, `MAIL_INBOUND_WEBHOOK_URL`, `MAIL_INBOUND_WEBHOOK_SECRET`, `MAIL_DKIM_SELECTOR`.
