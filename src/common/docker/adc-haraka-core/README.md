# adc-haraka-core

MTA self-hosted (Haraka) para la plataforma de correo ADC. Auto-provisionado por el
kernel si está junto a un módulo, o levantable con `docker compose up -d`.

- Puerto **25** (único publicado, en loopback): SMTP entrante + entrega interna del
  `email-service`. El 587 (submission) se habilita recién con envío externo (auth+TLS).
- Entrega entrante al `email-service` vía webhook firmado; los rechazos son en sesión
  (5xx/4xx), nunca acepta-y-rebota. **DKIM** firma saliente y verifica entrante.
- Anti-abuso: `early_talker`, topes por sesión (`limit`: errores/RCPT/comandos), `spf`
  en modo anotación y `adc_basic_spam`. El tráfico interno (IP privada) queda exento.
- **STARTTLS**: montar cert en `./tls/{cert,key}.pem` (gitignorado); sin certs arranca
  en claro. Clave DKIM en `./dkim/private`; DNS en [docs/guides/email-dns-setup.md](../../../../docs/guides/email-dns-setup.md).

Variables: `MAIL_HOSTNAME`, `MAIL_ROOT_DOMAIN`, `MAIL_INBOUND_WEBHOOK_URL`, `MAIL_INBOUND_WEBHOOK_SECRET`, `MAIL_DKIM_SELECTOR`.
