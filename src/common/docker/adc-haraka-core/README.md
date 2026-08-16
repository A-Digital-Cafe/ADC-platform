# adc-haraka-core

MTA self-hosted (Haraka) para la plataforma de correo ADC. Auto-provisionado por el
kernel si está junto a un módulo, o levantable con `docker compose up -d`.

- Puerto **25** (único publicado; loopback salvo `MAIL_BIND_HOST=0.0.0.0`): SMTP entrante
  + entrega interna del `email-service`. En loopback no se recibe correo de internet.
  El 587 (submission) se habilita recién con envío externo (auth+TLS).
- Entrega entrante al `email-service` vía webhook firmado; los rechazos son en sesión
  (5xx/4xx), nunca acepta-y-rebota. **DKIM** firma saliente y verifica entrante.
- Anti-abuso: `early_talker`, `spf` en modo anotación, `adc_basic_spam` y `limit` con topes
  por sesión (errores/RCPT/comandos) **y por IP en el tiempo** (conexiones y destinatarios),
  estos últimos contra el Redis de la plataforma por la red `adc-core-net`. El tráfico
  interno (IP privada) queda exento; sin Redis se pierden los topes, no el correo.
- **STARTTLS**: montar cert en `./tls/{cert,key}.pem` (gitignorado); sin certs arranca
  en claro. Clave DKIM en `./dkim/private`; DNS en [docs/guides/email-dns-setup.md](../../../../docs/guides/email-dns-setup.md).

Variables: `MAIL_HOSTNAME`, `MAIL_ROOT_DOMAIN`, `MAIL_BIND_HOST`, `MAIL_INBOUND_WEBHOOK_URL`, `MAIL_INBOUND_WEBHOOK_SECRET`, `MAIL_DKIM_SELECTOR`, `MAIL_REDIS_{HOST,PORT,USER,PASSWORD}` (usuario ACL propio, acotado a sus claves de rate; exige `REDIS_PASSWORD` para servir de algo).
